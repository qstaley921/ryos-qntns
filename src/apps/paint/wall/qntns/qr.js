/*
 * QNTNs QR — a QR Code encoder that fits in one file.
 * ===========================================================================
 * The postcard has to carry a scannable link back to the article, and the
 * theme has no runtime dependencies and cannot acquire one: package.json is
 * empty on purpose and tools/build-zip.mjs fails the build on any import that
 * leaves assets/. So the encoder is here, in full, rather than pulled from npm.
 *
 * WHAT THIS IS NOT. There is no decoder, no SVG output, no logo overlay, no
 * numeric or alphanumeric mode. A QR encoder can grow to several thousand
 * lines chasing the whole of ISO/IEC 18004; this one does exactly the job the
 * postcard needs — a short URL, in byte mode, painted onto a canvas — and
 * stops. Byte mode costs about 8% more modules than alphanumeric would for an
 * upper-case URL, which for a ~40 character link is the difference between a
 * version 3 and a version 3 symbol. It buys nothing and costs a whole second
 * encoding path.
 *
 * VERSIONS 1 THROUGH 10, ALL FOUR ECC LEVELS. Version 10 at level M holds 213
 * data bytes, which is far past any URL this theme will ever print. Stopping
 * at 10 is what lets the block tables below be ten entries long instead of
 * forty, and — more usefully — it is why the alignment-pattern step formula
 * needs no special case (the spec's one irregular version is 32).
 *
 * The numbers in the tables are from ISO/IEC 18004 Table 9 (codeword capacity
 * per version) and Tables 13-22 (error-correction blocks per version and
 * level). They are transcribed, not derived, and cited where they sit.
 */

/* -------------------------------------------------------------------------
 * GF(256) — the field the error correction lives in
 * ---------------------------------------------------------------------- */

/*
 * Reed-Solomon multiplies bytes, and bytes do not multiply. The QR spec picks
 * the field GF(2^8) with the primitive polynomial x^8 + x^4 + x^3 + x^2 + 1,
 * which is 0x11D, and inside that field every non-zero byte is some power of
 * 2. So multiplication becomes addition of exponents, which is why the two
 * tables below exist: EXP maps an exponent to its byte, LOG maps back.
 *
 * EXP is 512 long rather than 256 so that `EXP[LOG[a] + LOG[b]]` can be
 * written without a modulo — the sum of two logs is at most 508, and the top
 * half of the table is just the bottom half repeated. Dropping the `% 255`
 * from the inner loop of a Reed-Solomon divide is the whole reason.
 */
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(() => {
    let x = 1;
    for (let i = 0; i < 255; i++) {
        GF_EXP[i] = x;
        GF_LOG[x] = i;
        // Shift left, and fold back in the primitive polynomial the moment the
        // value would need a ninth bit.
        x <<= 1;
        if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

/* Zero has no logarithm, so it cannot go through the exponent tables at all;
   it has to be tested for rather than computed around. */
const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

/*
 * The generator polynomial for `degree` error-correction codewords is
 * (x - 2^0)(x - 2^1)...(x - 2^(degree-1)), multiplied out. Coefficients are
 * stored high-order-first with the leading 1 left off, because the leading
 * coefficient of a monic polynomial is known and carrying it would only make
 * the division loop below index around it.
 */
const rsGenerator = (degree) => {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
        const next = new Array(poly.length + 1).fill(0);
        for (let j = 0; j < poly.length; j++) {
            next[j] ^= poly[j];
            next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
        }
        poly = next;
    }
    return poly.slice(1);
};

/*
 * The error-correction codewords are the remainder of the data polynomial
 * divided by the generator. This is long division done in place: at each step
 * the leading term of the working remainder decides a multiple of the
 * generator to subtract, and subtraction in GF(2^8) is XOR.
 */
const rsRemainder = (data, generator) => {
    const result = new Uint8Array(generator.length);
    for (const byte of data) {
        const factor = byte ^ result[0];
        result.copyWithin(0, 1);
        result[result.length - 1] = 0;
        for (let i = 0; i < result.length; i++) {
            result[i] ^= gfMul(generator[i], factor);
        }
    }
    return result;
};

/* -------------------------------------------------------------------------
 * The tables
 * ---------------------------------------------------------------------- */

/* The four levels, in the order the spec numbers them for the format bits.
   ECC_BITS is what actually goes into the format information; it is NOT the
   index, because the spec orders the levels by the format-bit value (M, L, H,
   Q) rather than by how much correction they give. Keeping the two apart here
   is what stops that ordering surprising anything downstream. */
const ECC_LEVELS = ["L", "M", "Q", "H"];
const ECC_BITS = { L: 1, M: 0, Q: 3, H: 2 };

/*
 * ISO/IEC 18004 Tables 13-22, transcribed for versions 1-10 only.
 *
 * ECC_PER_BLOCK[level][version - 1] — error-correction codewords in each block.
 * BLOCKS[level][version - 1]        — how many blocks the data is split into.
 *
 * Everything else about the block layout is derived rather than transcribed:
 * total codewords come from the module count (see rawCodewords), data
 * codewords are what is left after the error correction, and the short/long
 * block split follows the spec's own rule that the long blocks are exactly one
 * codeword longer and sit at the end. Transcribing four more tables that are
 * all implied by these two would be four more chances to mistype a number.
 */
const ECC_PER_BLOCK = {
    L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
    M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
    Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
    H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28]
};

const BLOCKS = {
    L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
    M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
    Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
    H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8]
};

export const MAX_VERSION = 10;

/*
 * Table 9's codeword capacity, computed instead of transcribed.
 *
 * A symbol is size x size modules, minus everything the format reserves. The
 * closed form below is the standard one: start from the full square, subtract
 * the two timing rows, the three finders with their separators and format
 * areas, then the alignment patterns (which overlap the timing lines in a way
 * the (25n - 10)n - 55 term accounts for), then the two version blocks from
 * version 7 up. Dividing by 8 gives the codewords, and the leftover bits are
 * the remainder bits the spec leaves unused at the end of the symbol.
 */
const rawCodewords = (version) => {
    let modules = (16 * version + 128) * version + 64;
    if (version >= 2) {
        const aligns = Math.floor(version / 7) + 2;
        modules -= (25 * aligns - 10) * aligns - 55;
        if (version >= 7) modules -= 36;
    }
    return Math.floor(modules / 8);
};

const dataCodewords = (version, ecc) =>
    rawCodewords(version) - ECC_PER_BLOCK[ecc][version - 1] * BLOCKS[ecc][version - 1];

/*
 * Alignment pattern centres. The first is always at 6 — it shares the timing
 * line — and the rest are spread from the far edge back toward it at an even
 * step. The spec publishes these as a table; the formula reproduces it exactly
 * for every version except 32, which is past MAX_VERSION and so cannot be
 * reached from here. If MAX_VERSION is ever raised past 31, this needs the
 * special case adding.
 */
const alignmentPositions = (version) => {
    if (version === 1) return [];
    const count = Math.floor(version / 7) + 2;
    const size = version * 4 + 17;
    const step = Math.ceil((size - 13) / (2 * count - 2)) * 2;
    const positions = [6];
    for (let pos = size - 7; positions.length < count; pos -= step) positions.unshift(pos);
    return positions.sort((a, b) => a - b);
};

/* -------------------------------------------------------------------------
 * Encoding the data
 * ---------------------------------------------------------------------- */

/*
 * Byte mode is the only mode here, and byte mode's "byte" is whatever the
 * scanner decides it is. The spec's default is ISO-8859-1; every phone camera
 * in practice sniffs UTF-8 and gets it right. Emitting UTF-8 is therefore both
 * the more useful choice and the one that costs nothing for the ASCII URLs
 * this file is actually asked to encode — they are byte-identical either way.
 */
const toBytes = (text) => {
    if (typeof TextEncoder !== "undefined") return Array.from(new TextEncoder().encode(text));
    // A hand-rolled UTF-8 encoder, only for hosts old enough to lack the class.
    const out = [];
    for (const char of String(text)) {
        let code = char.codePointAt(0);
        if (code < 0x80) out.push(code);
        else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
    return out;
};

/* The character-count field is 8 bits for versions 1-9 and 16 from version 10.
   That boundary is the reason version selection has to be a search rather than
   arithmetic: a string that needs 9 versions' worth of room might tip over
   into 10 and then need two more bytes of header than it was measured with. */
const countBits = (version) => (version < 10 ? 8 : 16);

/*
 * Data codewords for one symbol: mode indicator, length, payload, then the
 * padding the spec requires.
 *
 * The padding is three separate things and they run in this order. First up to
 * four zero bits of terminator, but no more than the capacity has left. Then
 * zeros to the next byte boundary. Then the alternating 0xEC / 0x11 pad
 * codewords, whose only job is to give the symbol a busy, non-uniform tail
 * rather than a field of blank modules that would make masking harder.
 */
const encodeData = (bytes, version, ecc) => {
    const capacity = dataCodewords(version, ecc) * 8;
    const bits = [];
    const push = (value, length) => {
        for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    };

    push(0b0100, 4);                       // byte mode
    push(bytes.length, countBits(version));
    for (const byte of bytes) push(byte, 8);

    for (let i = 0; i < 4 && bits.length < capacity; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    const words = [];
    for (let i = 0; i < bits.length; i += 8) {
        let byte = 0;
        for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
        words.push(byte);
    }
    for (let pad = 0xec; words.length < capacity / 8; pad ^= 0xec ^ 0x11) words.push(pad);
    return words;
};

/*
 * Split into blocks, correct each one, then interleave.
 *
 * INTERLEAVING IS THE POINT OF THE BLOCKS. A scratch across the symbol damages
 * a contiguous run of codewords; if those codewords all belonged to one block
 * the block would be past saving, while its neighbours sat untouched. Taking
 * one codeword from each block in turn spreads any physical damage evenly over
 * every block's correction budget.
 *
 * Short blocks come first and long blocks are one codeword longer, so the last
 * data column is ragged — hence the `if (i < block.length)` guard on the data
 * pass. The error-correction blocks are all the same length and need no guard.
 */
const interleave = (words, version, ecc) => {
    const blockCount = BLOCKS[ecc][version - 1];
    const eccLength = ECC_PER_BLOCK[ecc][version - 1];
    const shortLength = Math.floor(words.length / blockCount);
    const longBlocks = words.length % blockCount;
    const generator = rsGenerator(eccLength);

    const data = [];
    const parity = [];
    let cursor = 0;
    for (let b = 0; b < blockCount; b++) {
        const length = shortLength + (b >= blockCount - longBlocks ? 1 : 0);
        const block = words.slice(cursor, cursor + length);
        cursor += length;
        data.push(block);
        parity.push(rsRemainder(block, generator));
    }

    const out = [];
    for (let i = 0; i <= shortLength; i++) {
        for (const block of data) if (i < block.length) out.push(block[i]);
    }
    for (let i = 0; i < eccLength; i++) {
        for (const block of parity) out.push(block[i]);
    }
    return out;
};

/* -------------------------------------------------------------------------
 * Building the matrix
 * ---------------------------------------------------------------------- */

const square = (size, value) => Array.from({ length: size }, () => new Array(size).fill(value));

/*
 * The function patterns: everything in the symbol that is fixed by the spec
 * rather than derived from the payload.
 *
 * `reserved` shadows `modules` and marks which cells the data pass must skip.
 * It has to be a separate grid and not a test like "is this cell already
 * dark", because plenty of function modules are light and a light finder
 * module is just as untouchable as a dark one.
 */
const drawFunctionPatterns = (modules, reserved, version) => {
    const size = modules.length;
    const set = (x, y, dark) => {
        if (x < 0 || y < 0 || x >= size || y >= size) return;
        modules[y][x] = dark;
        reserved[y][x] = true;
    };

    // Finder: a 7x7 target with its 1-module separator. Drawing the separator
    // as part of the same loop (an 8x8 window offset by -1) means the light
    // ring gets reserved too, which is what stops data leaking against the
    // finder and breaking the 1:1:3:1:1 ratio a scanner looks for.
    const finder = (cx, cy) => {
        for (let dy = -4; dy <= 4; dy++) {
            for (let dx = -4; dx <= 4; dx++) {
                const distance = Math.max(Math.abs(dx), Math.abs(dy));
                set(cx + dx, cy + dy, distance !== 2 && distance !== 4);
            }
        }
    };
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);

    // Timing: the alternating row and column that tell the scanner the module
    // pitch. Even coordinates are dark, and coordinate 6 is where they run.
    for (let i = 8; i < size - 8; i++) {
        set(i, 6, i % 2 === 0);
        set(6, i, i % 2 === 0);
    }

    // Alignment: 5x5 targets at every pairing of the centre positions, except
    // the three that would sit on top of a finder.
    const centres = alignmentPositions(version);
    for (let i = 0; i < centres.length; i++) {
        for (let j = 0; j < centres.length; j++) {
            const corner = (i === 0 && j === 0)
                || (i === 0 && j === centres.length - 1)
                || (i === centres.length - 1 && j === 0);
            if (corner) continue;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    set(centres[j] + dx, centres[i] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
                }
            }
        }
    }

    // The format areas are reserved now and written later, once a mask has been
    // chosen — the mask number is part of what they encode, and the mask cannot
    // be chosen until the data is placed.
    // Coordinate 6 is skipped in both runs: the format field jogs around the
    // timing lines rather than crossing them, and reserving those two cells
    // here would blank the timing modules that were just drawn.
    for (let i = 0; i < 9; i++) {
        if (i === 6) continue;
        set(i, 8, false);
        set(8, i, false);
    }
    for (let i = 0; i < 8; i++) {
        set(size - 1 - i, 8, false);
        set(8, size - 1 - i, false);
    }
    // The dark module. It is always dark, always here, and encodes nothing; it
    // exists so that the format area can never be entirely light.
    set(8, size - 8, true);

    if (version >= 7) drawVersionInfo(set, version, size);
};

/*
 * Version information, versions 7 and up: 6 data bits plus an 18-bit BCH code,
 * printed twice — once above the bottom-left finder and once left of the
 * top-right one. Two copies of the same 18 bits, at right angles, so a symbol
 * damaged along one edge can still be sized.
 *
 * Generator 0x1F25 is the spec's (18, 6) BCH polynomial. Unlike the format
 * information there is no final XOR mask: the version number is never zero in
 * the range where this field exists, so the all-light failure case the format
 * mask guards against cannot arise.
 */
const drawVersionInfo = (set, version, size) => {
    let remainder = version;
    for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (version << 12) | remainder;

    for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) === 1;
        const a = Math.floor(i / 3);
        const b = size - 11 + (i % 3);
        set(a, b, dark);
        set(b, a, dark);
    }
};

/*
 * Format information: 2 bits of ECC level, 3 of mask, and a 15-bit BCH code,
 * XORed with 0x5412 so that the all-zero format (level M, mask 0) still puts
 * something dark on the page for a scanner to lock onto.
 *
 * Written twice, like the version info, but here the two copies are split
 * awkwardly around the finders — the loop below is the spec's placement, and
 * the coordinate arithmetic is not derivable from anything, it is transcribed.
 */
const drawFormatInfo = (modules, ecc, mask) => {
    const size = modules.length;
    const data = (ECC_BITS[ecc] << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const bits = ((data << 10) | remainder) ^ 0x5412;

    const bit = (i) => ((bits >>> i) & 1) === 1;

    // First copy, wrapped around the top-left finder. Row 8 and column 8 both
    // jog past the timing line at 6, which is where the gaps in these two runs
    // come from.
    for (let i = 0; i <= 5; i++) modules[i][8] = bit(i);
    modules[7][8] = bit(6);
    modules[8][8] = bit(7);
    modules[8][7] = bit(8);
    for (let i = 9; i < 15; i++) modules[8][14 - i] = bit(i);

    // Second copy, split between the bottom-left and top-right finders.
    for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = bit(i);
};

/*
 * The data snake. Two-module-wide columns, right to left, running up then down
 * alternately, skipping every reserved cell.
 *
 * Column 6 is skipped entirely — it is the vertical timing line — and the skip
 * is done by stepping the column index rather than by testing inside the loop,
 * because the up/down alternation is keyed to the column's position in the
 * snake and not to its x coordinate. Shifting `right` from 6 to 5 keeps the
 * pairs aligned; a `continue` would flip the direction of every column left of
 * the timing line.
 */
const drawCodewords = (modules, reserved, words) => {
    const size = modules.length;
    let bit = 0;
    const total = words.length * 8;

    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let step = 0; step < size; step++) {
            for (let column = 0; column < 2; column++) {
                const x = right - column;
                const upward = ((right + 1) & 2) === 0;
                const y = upward ? size - 1 - step : step;
                if (reserved[y][x] || bit >= total) continue;
                modules[y][x] = ((words[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1;
                bit++;
            }
        }
    }
    // Any modules left over are the spec's remainder bits and stay light.
};

/* The eight masks, indexed by their spec number. Each takes the module's
   coordinates and says whether that module is inverted; every one is a pattern
   with no period that could line up with a finder. */
const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
];

const applyMask = (modules, reserved, mask) => {
    const size = modules.length;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (!reserved[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x];
        }
    }
};

/*
 * The penalty score, from the spec's four rules. Lower is better and the
 * lowest-scoring mask wins.
 *
 * Every rule is about how a camera fails, not about how the symbol looks. Long
 * single-colour runs (N1) and 2x2 blocks (N2) make it hard to count modules;
 * the 1:1:3:1:1 finder ratio appearing in the data (N3) makes the scanner
 * believe it has found a corner it has not; and an overall bias toward dark or
 * light (N4) narrows the gap the binarisation threshold has to sit in.
 */
const N1 = 3;
const N2 = 3;
const N3 = 40;
const N4 = 10;

const penalty = (modules) => {
    const size = modules.length;
    let score = 0;

    // Rules 1 and 3 over both axes. `at` reads the grid in whichever
    // orientation this pass wants, so the run and pattern logic is written
    // once instead of twice with the indices swapped.
    for (const transposed of [false, true]) {
        const at = (i, j) => (transposed ? modules[j][i] : modules[i][j]);
        for (let i = 0; i < size; i++) {
            let runColour = at(i, 0);
            let runLength = 1;
            for (let j = 1; j < size; j++) {
                if (at(i, j) === runColour) {
                    runLength++;
                    if (runLength === 5) score += N1;
                    else if (runLength > 5) score += 1;
                } else {
                    runColour = at(i, j);
                    runLength = 1;
                }
            }
            // Rule 3 is a literal window match: the finder ratio with four
            // light modules on one side. Off-grid positions read as light,
            // which is correct — outside the symbol is the quiet zone.
            const cell = (j) => (j < 0 || j >= size ? false : at(i, j));
            for (let j = 0; j < size; j++) {
                const core = [1, 0, 1, 1, 1, 0, 1].every(
                    (want, k) => cell(j + k) === (want === 1)
                );
                if (!core) continue;
                const before = [-4, -3, -2, -1].every((k) => !cell(j + k));
                const after = [7, 8, 9, 10].every((k) => !cell(j + k));
                if (before || after) score += N3;
            }
        }
    }

    // Rule 2: every 2x2 block of one colour. Overlapping blocks each count,
    // so a solid 3x3 area scores four times, which is the intent.
    for (let y = 0; y < size - 1; y++) {
        for (let x = 0; x < size - 1; x++) {
            const c = modules[y][x];
            if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) {
                score += N2;
            }
        }
    }

    // Rule 4: how far the dark proportion strays from half, in steps of 5%.
    let dark = 0;
    for (const row of modules) for (const cell of row) if (cell) dark++;
    const total = size * size;
    const drift = Math.abs(dark * 100 - total * 50);
    score += Math.floor(drift / (total * 5)) * N4;

    return score;
};

/* -------------------------------------------------------------------------
 * Public API
 * ---------------------------------------------------------------------- */

/*
 * Encode `text` into the smallest symbol that will hold it and return the
 * matrix as rows of booleans, true meaning a dark module. The quiet zone is
 * NOT included — it is not part of the code, it is space around it, and
 * whoever paints the thing is the one who knows how much room there is.
 *
 * The version search runs the whole encode at each candidate rather than
 * comparing byte counts, because the character-count field grows at version 10
 * and a "does it fit" test that forgot that would be wrong by two bytes on
 * exactly the boundary where it matters.
 */
export const qrMatrix = (text, { ecc = "M" } = {}) => {
    const level = String(ecc).toUpperCase();
    if (!ECC_LEVELS.includes(level)) throw new Error(`qrMatrix: unknown ECC level ${ecc}`);

    const bytes = toBytes(String(text));
    let version = 0;
    for (let candidate = 1; candidate <= MAX_VERSION; candidate++) {
        const needed = 4 + countBits(candidate) + bytes.length * 8;
        if (needed <= dataCodewords(candidate, level) * 8) {
            version = candidate;
            break;
        }
    }
    if (!version) {
        throw new Error(
            `qrMatrix: ${bytes.length} bytes does not fit a version ${MAX_VERSION} symbol at level ${level}`
        );
    }

    const size = version * 4 + 17;
    const modules = square(size, false);
    const reserved = square(size, false);
    drawFunctionPatterns(modules, reserved, version);
    drawCodewords(modules, reserved, interleave(encodeData(bytes, version, level), version, level));

    /*
     * All eight masks are tried and scored, then the winner is re-applied.
     * Each trial writes the format information first, because the format bits
     * carry the mask number and so change with it — scoring an unmasked format
     * area would score a symbol that is never printed.
     *
     * Undoing a mask is applying it again: it is an XOR.
     */
    let best = 0;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
        applyMask(modules, reserved, mask);
        drawFormatInfo(modules, level, mask);
        const score = penalty(modules);
        if (score < bestScore) {
            bestScore = score;
            best = mask;
        }
        applyMask(modules, reserved, mask);
    }
    applyMask(modules, reserved, best);
    drawFormatInfo(modules, level, best);

    return modules;
};

/*
 * The quiet zone is four modules on every side and it is mandatory — a symbol
 * printed hard against other ink is a symbol a camera cannot find the edge of.
 * It is counted INSIDE `size` so that a caller reserving a square of the
 * postcard gets a code that is guaranteed to be scannable within it, rather
 * than one that silently needs a margin nobody allocated.
 */
export const QUIET_ZONE = 4;

/*
 * Paint the code as dark squares only. No background is filled: the postcard's
 * beige is the light module, so the card's own paper shows through and the
 * code picks up whatever the card is made of.
 *
 * MODULE EDGES ARE SNAPPED TO WHOLE UNITS, THE GRID IS NOT. The obvious
 * implementation — scale the context by size/count and fill unit squares — puts
 * module edges on fractional coordinates, and the renderer then antialiases
 * every shared edge into a grey seam. At small sizes those seams are a
 * meaningful fraction of a module and they are exactly what a scanner's
 * threshold has to guess at.
 *
 * So each module's two edges are rounded independently, from the exact
 * fractional grid, rather than the module PITCH being rounded once. Two adjacent
 * modules therefore share one rounded coordinate and merge into a solid
 * rectangle with no seam — the property flooring the pitch was bought for — and
 * the grid still spans `size` exactly. Individual modules end up differing by a
 * unit here and there, which is invisible and is what every renderer does.
 *
 * Flooring the pitch, which is what this used to do, cost up to `count - 1`
 * units off the whole code. On a 128-unit box with a 33-unit grid it drew at 99,
 * which is a quarter of the box thrown away before the quiet zone takes its
 * share.
 *
 * `quiet` IS THE QUIET ZONE IN MODULES AND IT CAN BE ZERO. The spec's 4 is the
 * default and it is reserved INSIDE `size`, which is right when the code is
 * being dropped onto an unknown background. When the caller already knows there
 * is clear space around the box — the postcard does; its margins are several
 * times the required zone — passing 0 lets the code fill the box it was given
 * instead of paying for a margin twice. The zone still has to exist, it is just
 * the caller's to provide.
 */
export const drawQr = (ctx, text, x, y, size, color, { quiet = QUIET_ZONE } = {}) => {
    const modules = qrMatrix(text, { ecc: "M" });
    const count = modules.length + quiet * 2;

    const step = size / count;
    const originX = Math.round(x);
    const originY = Math.round(y);
    // The exact grid, rounded per edge. edge(0) is 0 and edge(count) is `size`,
    // so the code lands flush against both ends of the box it was given.
    const edge = (i) => Math.round(i * step);

    ctx.save();
    ctx.fillStyle = color;
    for (let row = 0; row < modules.length; row++) {
        const top = originY + edge(row + quiet);
        const height = originY + edge(row + 1 + quiet) - top;
        // Runs of dark modules are filled as one rectangle rather than one per
        // module. It is fewer draw calls, but the reason is the seam again: two
        // separate fills sharing an edge can still show a hairline where a
        // single wider fill cannot.
        let run = 0;
        for (let column = 0; column <= modules.length; column++) {
            if (column < modules.length && modules[row][column]) {
                run++;
                continue;
            }
            if (run) {
                const left = originX + edge(column - run + quiet);
                ctx.fillRect(left, top, originX + edge(column + quiet) - left, height);
                run = 0;
            }
        }
    }
    ctx.restore();
};
