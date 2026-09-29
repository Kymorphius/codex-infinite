// Reinstall idempotent page clients after the native renderer changes contexts.
export async function installBindings(connection, bindings) {
  for (const binding of bindings) {
    await connection.send('Runtime.addBinding', { name: binding.name });
    if (binding.source) await connection.send('Runtime.evaluate', { expression: binding.source });
  }
}
