/* =====================================================================
   seguranca.js — hash de senhas
   SHA-256 escrito em JavaScript puro para funcionar igual em qualquer
   navegador, inclusive abrindo o sistema por file:// (duplo clique),
   onde crypto.subtle pode não estar disponível.
   ===================================================================== */

const SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Hex(texto) {
  const bytes = new TextEncoder().encode(texto);
  const tam = bytes.length;
  const blocos = Math.ceil((tam + 9) / 64);
  const buf = new Uint8Array(blocos * 64);
  buf.set(bytes);
  buf[tam] = 0x80;
  const dv = new DataView(buf.buffer);
  const bits = tam * 8;
  dv.setUint32(blocos * 64 - 8, Math.floor(bits / 4294967296), false);
  dv.setUint32(blocos * 64 - 4, bits >>> 0, false);

  let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  const rr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

  for (let i = 0; i < blocos; i++) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i * 64 + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const s0 = rr(w[t - 15], 7) ^ rr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rr(w[t - 2], 17) ^ rr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t++) {
      const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA_K[t] + w[t]) >>> 0;
      const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H = [(H[0] + a) >>> 0, (H[1] + b) >>> 0, (H[2] + c) >>> 0, (H[3] + d) >>> 0,
         (H[4] + e) >>> 0, (H[5] + f) >>> 0, (H[6] + g) >>> 0, (H[7] + h) >>> 0];
  }
  return H.map((x) => x.toString(16).padStart(8, '0')).join('');
}

// Repetir o hash encarece tentativas de força bruta e continua instantâneo no uso normal.
const HASH_VOLTAS = 600;
function hashSenha(senha) {
  let h = 'barbearia::v2::' + senha;
  for (let i = 0; i < HASH_VOLTAS; i++) h = sha256Hex(h);
  return h;
}

/* ---------------------------------------------------------------------
   Compatibilidade com senhas criadas nas versões anteriores.
   Antes o hash era SHA-256 de uma volta (ou, quando crypto.subtle não
   existia, um hash FNV). Quem já tinha senha cadastrada continua entrando
   normalmente: ao acertar, a senha é regravada no formato novo.
   --------------------------------------------------------------------- */
function hashLegadoSha(senha) { return sha256Hex('barbearia::' + senha); }
function hashLegadoFnv(senha) {
  const dados = new TextEncoder().encode('barbearia::' + senha);
  let h = 0x811c9dc5;
  for (const b of dados) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return 'fnv:' + h.toString(16);
}

/**
 * Confere a senha contra o hash guardado, aceitando os formatos antigos.
 * @param {function} aoAtualizar recebe o hash novo quando a senha veio de um formato antigo
 */
function conferirSenha(senha, hashGuardado, aoAtualizar) {
  if (!hashGuardado) return false;
  if (hashSenha(senha) === hashGuardado) return true;
  if (hashGuardado === hashLegadoSha(senha) || hashGuardado === hashLegadoFnv(senha)) {
    if (aoAtualizar) aoAtualizar(hashSenha(senha));
    return true;
  }
  return false;
}
