import net from 'node:net';
import tls from 'node:tls';

export type SmtpAuth = { user: string; pass: string };

export type SmtpConnectOptions = {
  /** Host del servidor SMTP. */
  host: string;
  /** Puerto: 465 (TLS implícito) o 587 (STARTTLS). */
  port: number;
  /** Credenciales; si se omiten, se intenta sin AUTH. */
  auth?: SmtpAuth;
  /** Timeout de conexión y de cada operación, en ms. */
  timeoutMs?: number;
  /** Nombre announced en EHLO. */
  heloName?: string;
};

export type SmtpSendOptions = SmtpConnectOptions & {
  /** Remitente (MAIL FROM). */
  from: string;
  /** Destinatarios (RCPT TO). */
  to: string[];
  /** Mensaje completo con encabezados y cuerpo, terminados en CRLF. */
  message: string;
};

export type SmtpResult =
  | { ok: true; response: string }
  | { ok: false; error: string; stage: string };

/** Errores del protocolo SMTP que conviene distinguir en los logs. */
class SmtpError extends Error {
  constructor(
    message: string,
    readonly stage: string,
  ) {
    super(message);
    this.name = 'SmtpError';
  }
}

/** Lee líneas de un socket, decodificando UTF-8. */
class LineReader {
  private buffer = '';
  private readonly pending: string[] = [];
  private readonly waiters: ((line: string) => void)[] = [];
  private failure: Error | null = null;

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let index = this.buffer.indexOf('\n');
      while (index !== -1) {
        const line = this.buffer.slice(0, index).replace(/\r$/, '');
        this.buffer = this.buffer.slice(index + 1);
        const waiter = this.waiters.shift();
        if (waiter) waiter(line);
        else this.pending.push(line);
        index = this.buffer.indexOf('\n');
      }
    });
    socket.on('error', (error) => {
      this.failure = error;
      this.flush();
    });
    socket.on('close', () => {
      this.failure ??= new Error('Conexión SMTP cerrada inesperadamente.');
      this.flush();
    });
  }

  private flush(): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.('');
    }
  }

  /** Devuelve la siguiente línea; '' si la conexión se cerró. */
  next(): Promise<string> {
    const line = this.pending.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

/**
 * Extrae la dirección de correo de un valor de encabezado From/To.
 * "AyrNetworx <admin@ayrnetworxv.ve>" → "admin@ayrnetworxv.ve"
 * MAIL FROM y RCPT TO no admiten el formato con nombre.
 */
export function extractEmailAddress(value: string): string {
  const angled = /<([^>]+)>/.exec(value);
  if (angled) return angled[1]!.trim();
  return value.trim();
}

/** Conexión SMTP con soporte de TLS implícito (465) y STARTTLS (587). */
export class SmtpClient {
  private socket: net.Socket | tls.TLSSocket;
  private reader: LineReader;
  private readonly timeoutMs: number;
  private readonly heloName: string;
  private readonly capabilities = new Set<string>();
  private readonly authMechanisms = new Set<string>();

  private constructor(socket: net.Socket | tls.TLSSocket, timeoutMs: number, heloName: string) {
    this.socket = socket;
    this.reader = new LineReader(socket);
    this.timeoutMs = timeoutMs;
    this.heloName = heloName;
  }

  /** Abre una conexión: TLS implícito en 465, STARTTLS en 587. */
  static async connect(options: SmtpConnectOptions): Promise<SmtpClient> {
    const timeoutMs = options.timeoutMs ?? 15_000;
    const heloName = options.heloName ?? 'ayr-backend';

    const socket =
      options.port === 465
        ? await tls.connect({ host: options.host, port: options.port, servername: options.host })
        : await net.connect({ host: options.host, port: options.port });

    socket.setTimeout(timeoutMs);

    const client = new SmtpClient(socket, timeoutMs, heloName);
    await client.readResponse('greeting');
    await client.ehlo();

    if (options.port !== 465) {
      await client.startTls(options.host);
      await client.ehlo();
    }

    if (options.auth) {
      await client.auth(options.auth);
    }

    return client;
  }

  /** Envía el mensaje y cierra la conexión. */
  async send(options: { from: string; to: string[]; message: string }): Promise<SmtpResult> {
    try {
      await this.command(`MAIL FROM:<${extractEmailAddress(options.from)}>`, 'mail-from');
      for (const recipient of options.to) {
        await this.command(`RCPT TO:<${extractEmailAddress(recipient)}>`, 'rcpt-to');
      }
      await this.command('DATA', 'data');

      // El cuerpo se escapa con ".." si alguna línea empieza por ".".
      const body = options.message.replace(/\r?\n/g, '\r\n');
      await this.write(`${body}\r\n.\r\n`);
      await this.readResponse('data-body');

      await this.command('QUIT', 'quit').catch(() => undefined);
      this.socket.end();
      return { ok: true, response: 'Mensaje aceptado por el servidor.' };
    } catch (error) {
      this.socket.destroy();
      const stage = error instanceof SmtpError ? error.stage : 'desconocido';
      return { ok: false, error: error instanceof Error ? error.message : String(error), stage };
    }
  }

  /** Cierra la conexión sin enviar nada. */
  close(): void {
    this.socket.end();
  }

  private async ehlo(): Promise<void> {
    const response = await this.command(`EHLO ${this.heloName}`, 'ehlo');
    for (const line of response.split('\n')) {
      const match = /^250[- ]?([A-Z0-9-]+)(.*)$/.exec(line.trim());
      if (!match) continue;
      const capability = match[1]!;
      this.capabilities.add(capability);
      // La línea AUTH lista los mecanismos: "250-AUTH PLAIN LOGIN".
      if (capability === 'AUTH') {
        for (const mechanism of (match[2] ?? '').trim().split(/\s+/)) {
          if (mechanism) this.authMechanisms.add(mechanism.toUpperCase());
        }
      }
    }
  }

  private async startTls(host: string): Promise<void> {
    if (!this.capabilities.has('STARTTLS')) {
      throw new SmtpError('El servidor no anuncia STARTTLS.', 'starttls');
    }
    await this.command('STARTTLS', 'starttls');

    const secure = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const tlsSocket = tls.connect({ socket: this.socket as net.Socket, servername: host }, () => {
        resolve(tlsSocket);
      });
      tlsSocket.once('error', reject);
    });
    secure.setTimeout(this.timeoutMs);
    this.socket = secure;
    this.reader = new LineReader(secure);
  }

  private async auth(auth: SmtpAuth): Promise<void> {
    if (!this.capabilities.has('AUTH')) {
      throw new SmtpError('El servidor no ofrece AUTH.', 'auth');
    }
    if (this.authMechanisms.has('PLAIN')) {
      const token = Buffer.from(`\0${auth.user}\0${auth.pass}`, 'utf8').toString('base64');
      await this.command(`AUTH PLAIN ${token}`, 'auth');
      return;
    }
    if (this.authMechanisms.has('LOGIN')) {
      await this.command('AUTH LOGIN', 'auth');
      await this.command(Buffer.from(auth.user, 'utf8').toString('base64'), 'auth');
      await this.command(Buffer.from(auth.pass, 'utf8').toString('base64'), 'auth');
      return;
    }
    const offered = [...this.authMechanisms].join(', ') || 'ninguno';
    throw new SmtpError(`El servidor no admite AUTH PLAIN ni AUTH LOGIN (ofrece: ${offered}).`, 'auth');
  }

  private async command(text: string, stage: string): Promise<string> {
    await this.write(`${text}\r\n`);
    return this.readResponse(stage);
  }

  private write(data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.write(data, (error) => (error ? reject(error) : resolve()));
    });
  }

  /** Lee la respuesta completa, incluyendo continuaciones "250-". */
  private async readResponse(stage: string): Promise<string> {
    const lines: string[] = [];
    for (;;) {
      const line = await this.reader.next();
      if (line === '') {
        throw new SmtpError('El servidor cerró la conexión durante la respuesta.', stage);
      }
      lines.push(line);
      const match = /^(\d{3})([ -])/.exec(line);
      if (!match) {
        throw new SmtpError(`Respuesta SMTP no reconocida: "${line}"`, stage);
      }
      if (match[2] === ' ') break;
    }
    const code = Number.parseInt(lines[lines.length - 1]!.slice(0, 3), 10);
    if (code >= 400) {
      throw new SmtpError(`El servidor rechazó la operación (${code}): ${lines.join(' | ')}`, stage);
    }
    return lines.join('\n');
  }
}

/** Envía un mensaje por SMTP y devuelve el resultado sin lanzar excepciones. */
export async function sendViaSmtp(options: SmtpSendOptions): Promise<SmtpResult> {
  let client: SmtpClient | null = null;
  try {
    client = await SmtpClient.connect(options);
    return await client.send({ from: options.from, to: options.to, message: options.message });
  } catch (error) {
    const stage = error instanceof SmtpError ? error.stage : 'conexion';
    return { ok: false, error: error instanceof Error ? error.message : String(error), stage };
  } finally {
    client?.close();
  }
}
