import { randomUUID } from 'node:crypto';

const modulePath = process.argv[2];
if (!modulePath || !process.send) throw new Error('Worker requires a module and IPC channel');
const worker = await import(modulePath) as { handle: (input: unknown) => unknown };
process.on('message', (message: { id: string; input: unknown }) => {
  void Promise.resolve().then(() => worker.handle(message.input)).then(
    result => process.send?.({ id: message.id, result }),
    error => process.send?.({ id: message.id, error: error instanceof Error ? error.message : String(error) }),
  );
});
process.send({ ready: randomUUID() });
