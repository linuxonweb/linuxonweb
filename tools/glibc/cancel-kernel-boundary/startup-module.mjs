/* Candidate loader gate only. The compiler/source admission seal and actual
 * owner/root authentication remain separate. Inspecting a Module never executes
 * its start function; this check must run before creating any GNU Instance. */
export function checkGNUStartupModule(bytes, module) {
    const exports = WebAssembly.Module.exports(module);
    if (!exports.some(item => item.name === "__wasm_boundary_v3_admit" && item.kind === "function"))
        return false; // Existing v1 payloads retain their loader behavior.
    if (!(bytes instanceof Uint8Array) || bytes.length < 8 ||
        [0, 97, 115, 109, 1, 0, 0, 0].some((value, i) => bytes[i] !== value))
        throw new Error("GNU startup module bytes");
    let offset = 8;
    const u32 = () => {
        let value = 0;
        for (let count = 0; count < 5; ++count) {
            if (offset >= bytes.length) throw new Error("GNU startup section truncated");
            const byte = bytes[offset++];
            if (count === 4 && (byte & 0xf0)) throw new Error("GNU startup section length overflow");
            value += (byte & 0x7f) * 2 ** (7 * count);
            if (!(byte & 0x80)) return value;
        }
        throw new Error("GNU startup section length malformed");
    };
    while (offset < bytes.length) {
        const id = bytes[offset++];
        const length = u32();
        if (length > bytes.length - offset) throw new Error("GNU startup section bounds");
        if (id === 8) throw new Error("GNU startup start section precedes authenticated mask");
        offset += length;
    }
    return true;
}
