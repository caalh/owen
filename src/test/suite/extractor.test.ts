import * as assert from 'assert';
import { extractCylinders } from '../../preview/extractor';

suite('OWEN preview extractor', () => {
    test('extracts at least one MCNP cz cylinder', () => {
        const deck = [
            'Tiny pin cell',
            '1  1 -10.4 -1  imp:n=1',
            '2  2 -0.998 1  imp:n=1',
            '3  0       2  imp:n=0',
            '',
            '1 cz 0.41',
            '2 cz 0.47',
            '',
            'm1 92235.80c 0.04',
            '   92238.80c 0.96',
            '   8016.80c  2.0',
        ].join('\n');
        const cylinders = extractCylinders(deck, 'mcnp');
        assert.ok(cylinders.length >= 1, `expected at least one cylinder, got ${cylinders.length}`);
        assert.ok(cylinders.some((c) => Math.abs(c.radius - 0.41) < 1e-6),
            'expected a cylinder with radius 0.41');
    });

    test('extracts OpenMC fuel radius from a Python snippet', () => {
        // GROVES `_parse_openmc_python` is a keyword-driven heuristic; it picks up
        // `fuel_or` / `fuel_radius` assignments and produces a 2-layer pin (fuel + clad).
        const deck = [
            'import openmc',
            'fuel_or = openmc.ZCylinder(r=0.40)',
            'm = openmc.Material()',
            'cell = openmc.Cell(region=-fuel_or, fill=m)',
            'model = openmc.Model()',
        ].join('\n');
        const cylinders = extractCylinders(deck, 'openmc');
        assert.ok(cylinders.length >= 1, `expected at least one cylinder, got ${cylinders.length}`);
        assert.ok(cylinders.some((c) => Math.abs(c.radius - 0.40) < 1e-6),
            'expected a cylinder with radius 0.40 (fuel)');
    });

    test('extracts Serpent pin layers from a pin block', () => {
        // GROVES `_parse_serpent` mirrors Serpent `pin <name>` blocks — material
        // followed by an optional radius, terminated by a bare material line.
        // The Python implementation does NOT parse `surf <id> cyl ...` cards; we
        // mirror that behaviour for parity.
        const deck = [
            'pin myPin',
            'fuel 0.40',
            'clad 0.46',
            'water',
            '',
        ].join('\n');
        const cylinders = extractCylinders(deck, 'serpent');
        assert.ok(cylinders.length >= 1, `expected at least one cylinder, got ${cylinders.length}`);
        assert.ok(cylinders.some((c) => Math.abs(c.radius - 0.40) < 1e-6),
            'expected a cylinder with radius 0.40 (fuel layer)');
    });

    test('extracts SCONE pin universe layers', () => {
        // SCONE `pinUniverse` block: trailing 0.0 radius is filtered out, so a
        // (0.4 0.0) radii list yields a single cylinder of radius 0.4.
        const deck = 'fuelPin { id 1; type pinUniverse; radii (0.4 0.0); fills (fuel cool); }';
        const cylinders = extractCylinders(deck, 'scone');
        assert.ok(cylinders.length >= 1, `expected at least one cylinder, got ${cylinders.length}`);
        assert.ok(cylinders.some((c) => Math.abs(c.radius - 0.4) < 1e-6),
            'expected a cylinder with radius 0.4');
    });

    test('returns empty array for unknown languages', () => {
        const cylinders = extractCylinders('whatever', 'fortran-77');
        assert.deepStrictEqual(cylinders, []);
    });
});
