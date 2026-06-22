// Pure, vscode-free helpers for the MCNP card-image line-length guard.
//
// MCNP "card images" (single input lines) were limited to 80 columns for ~40
// years (MCNP5, MCNP6.1 and earlier); characters past the limit are silently
// ignored, a classic source of "my card had no effect" bugs. MCNP6.2+ raised
// the limit to 128 columns. We default to 80 (portable — flags anything that
// would truncate on the broadest set of MCNP versions) and let the user raise
// it via owen.mcnp.lineLengthLimit.
//
// Tab handling: MCNP expands tabs to the next 8-column tab stop and applies the
// limit AFTER expansion, so we measure expanded width — a line that looks short
// with tabs can still overflow once expanded.

export const MCNP_DEFAULT_LINE_LIMIT = 80;
export const TAB_WIDTH = 8;

export interface OverlengthLine {
    /** 0-based line index. */
    line: number;
    /** 0-based column where the overflow begins (== limit). */
    startCol: number;
    /** Expanded (tab-aware) length of the full line. */
    expandedLength: number;
    /** Raw character length of the line (no tab expansion). */
    rawLength: number;
}

/**
 * Expand tabs to {@link TAB_WIDTH}-column tab stops, returning the visual column
 * count the line would occupy in MCNP after tab expansion.
 */
export function expandedWidth(line: string, tabWidth: number = TAB_WIDTH): number {
    let col = 0;
    for (const ch of line) {
        if (ch === '\t') {
            col += tabWidth - (col % tabWidth);
        } else {
            col += 1;
        }
    }
    return col;
}

/**
 * Find every line whose tab-expanded width exceeds `limit`. Used by both the
 * diagnostic provider and the editor decoration so the two never disagree.
 *
 * @param text  full document text (any newline style)
 * @param limit max columns allowed (default {@link MCNP_DEFAULT_LINE_LIMIT})
 */
export function findOverlengthLines(
    text: string,
    limit: number = MCNP_DEFAULT_LINE_LIMIT,
): OverlengthLine[] {
    const out: OverlengthLine[] = [];
    const lines = text.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const expanded = expandedWidth(raw);
        if (expanded > limit) {
            out.push({
                line: i,
                startCol: limit,
                expandedLength: expanded,
                rawLength: raw.length,
            });
        }
    }
    return out;
}
