import * as assert from 'assert';
import {
    expandedWidth,
    findOverlengthLines,
    MCNP_DEFAULT_LINE_LIMIT,
} from '../../decorations/lineLength';

suite('OWEN MCNP line-length guard', () => {
    test('default limit is the classic 80-column card image', () => {
        assert.strictEqual(MCNP_DEFAULT_LINE_LIMIT, 80);
    });

    test('expandedWidth counts tabs to the next 8-column stop', () => {
        assert.strictEqual(expandedWidth('abc'), 3);
        assert.strictEqual(expandedWidth('\t'), 8);
        assert.strictEqual(expandedWidth('a\t'), 8); // 1 → next stop at 8
        assert.strictEqual(expandedWidth('abcdefg\t'), 8); // 7 → 8
        assert.strictEqual(expandedWidth('abcdefgh\t'), 16); // 8 → 16
    });

    test('flags lines longer than the limit', () => {
        const short = 'c '.padEnd(80, 'x'); // exactly 80
        const long = 'c '.padEnd(81, 'x'); // 81 columns
        const text = [short, long, 'm1 92235.80c 1.0'].join('\n');
        const over = findOverlengthLines(text, 80);
        assert.strictEqual(over.length, 1);
        assert.strictEqual(over[0].line, 1);
        assert.strictEqual(over[0].startCol, 80);
        assert.strictEqual(over[0].expandedLength, 81);
    });

    test('80-column line is allowed; 81 is flagged', () => {
        assert.strictEqual(findOverlengthLines('x'.repeat(80), 80).length, 0);
        assert.strictEqual(findOverlengthLines('x'.repeat(81), 80).length, 1);
    });

    test('tab expansion can push an apparently-short line over the limit', () => {
        // 75 visible chars + a tab that expands well past 80.
        const line = 'x'.repeat(79) + '\t' + 'y';
        const over = findOverlengthLines(line, 80);
        assert.strictEqual(over.length, 1);
        assert.ok(over[0].expandedLength > 80);
    });

    test('honors a custom (e.g. MCNP6.2 128-column) limit', () => {
        const line = 'x'.repeat(100);
        assert.strictEqual(findOverlengthLines(line, 80).length, 1);
        assert.strictEqual(findOverlengthLines(line, 128).length, 0);
    });
});
