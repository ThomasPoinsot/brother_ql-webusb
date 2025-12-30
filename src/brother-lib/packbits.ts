/**
 * PackBits encoding implementation.
 * @param data The data to encode.
 * @returns The encoded data.
 */
export function encodePackBits(data: Uint8Array): Uint8Array {
    const result: number[] = [];
    let i = 0;

    while (i < data.length) {
        let run = 1;

        // Check for a run of identical characters
        while (i + run < data.length && data[i + run] === data[i] && run < 128) {
            run++;
        }

        if (run > 1) {
            // Encode a run: [-(run-1), byte]
            result.push(256 - (run - 1));
            result.push(data[i]);
            i += run;
        } else {
            // Check for a sequence of non-identical characters
            let literal = 1;
            while (i + literal < data.length && literal < 128) {
                // A run starts if there are two or more identical characters
                if (i + literal + 1 < data.length && data[i + literal] === data[i + literal + 1]) {
                    break;
                }
                literal++;
            }

            // Encode a literal: [literal-1, bytes...]
            result.push(literal - 1);
            for (let j = 0; j < literal; j++) {
                result.push(data[i + j]);
            }
            i += literal;
        }
    }

    return new Uint8Array(result);
}
