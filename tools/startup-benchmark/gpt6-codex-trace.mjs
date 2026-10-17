export async function finishTrace(send, targetId) {
  if (typeof targetId !== 'string' || !targetId) throw Error('Missing owned page identity');
  const result = await send('Target.closeTarget', { targetId });
  if (!result.success) throw Error('Could not close owned tracing page');
  await send('Tracing.end', {});
}

export async function collectTrace(send, handle, write, { maxBytes = 128 * 1024 ** 2, maxChunks = 4096 } = {}) {
  let bytes = 0, chunks = 0, failed = false;
  try {
    while (chunks < maxChunks) {
      const reply = await send('IO.read', { handle, size: 65536 });
      const chunk = Buffer.from(reply.data, reply.base64Encoded ? 'base64' : 'utf8');
      if (bytes + chunk.length > maxBytes) throw Error('Trace byte limit exceeded');
      await write(chunk);
      bytes += chunk.length;
      chunks++;
      if (reply.eof) return { bytes, chunks };
    }
    throw Error('Trace chunk limit exceeded');
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try { await send('IO.close', { handle }); }
    catch (error) { if (!failed) throw error; }
  }
}
