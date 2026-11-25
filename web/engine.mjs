export async function engine(bytes) {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const wasm = instance.exports,
    encoder = new TextEncoder(),
    decoder = new TextDecoder();
  return (command) => {
    const data = encoder.encode(JSON.stringify(command));
    const ptr = wasm.input(data.length);
    new Uint8Array(wasm.memory.buffer, ptr, data.length).set(data);
    const length = wasm.execute();
    const response = JSON.parse(
      decoder.decode(new Uint8Array(wasm.memory.buffer, wasm.output(), length)),
    );
    if (response.error) throw Error(response.error);
    return response;
  };
}
