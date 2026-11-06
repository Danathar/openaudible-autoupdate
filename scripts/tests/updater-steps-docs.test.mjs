// README.md, AGENTS.md and docs/security/SECURITY-AI.md each describe what
// openaudible-autoupdate.sh does on a run: the order of its steps, the curl
// options it passes, the time limits on both downloads and the shape each
// manifest value must have. Nothing held those copies to the script, and
// SECURITY-AI's "Manifest fields are untrusted" went on saying `download_dir`
// was unchecked long after the script began refusing anything but an https://
// URL. These tests read the options, the order and the patterns from the
// script and hold each page to them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const UPDATER = 'openaudible-autoupdate.sh';
const TIMER = 'systemd/openaudible-autoupdate.timer';
const AGENTS = 'AGENTS.md';
const README = 'README.md';
const SECURITY = 'docs/security/SECURITY-AI.md';
const script = read(UPDATER);

function section(page, heading) {
    const lines = read(page).split('\n');
    const start = lines.indexOf(heading);
    assert.notEqual(start, -1, `${page} has no ${JSON.stringify(heading)} heading`);
    const end = lines.findIndex((l, i) => i > start && /^#{1,3} /.test(l));
    return lines.slice(start + 1, end === -1 ? undefined : end).join('\n').replace(/\s*\n\s*/g, ' ');
}

const howItWorks = () => section(README, '## How it works');
const whatThisRepoIs = () => section(AGENTS, '## What this repo is');
const manifestFields = () => section(SECURITY, '### 1.2 Manifest fields are untrusted');

// The one curl line that fetches `target`, as a map of its long options.
function curlOptions(target) {
    const found = script.split('\n').filter((l) => /\bcurl -fsSL\b/.test(l) && l.includes(target));
    assert.equal(found.length, 1, `expected one curl line for ${target} in ${UPDATER}`);
    return Object.fromEntries([...found[0].matchAll(/(--[a-z-]+) ([^\s"]+)/g)].map((m) => [m[1], m[2]]));
}
const manifestCurl = () => curlOptions('"$VERSION_URL"');
const rpmCurl = () => curlOptions('"${download_dir}${file_name}"');

// The pattern a `[[ "$name" =~ ... ]]` check holds `name` to, in JavaScript
// syntax (the one POSIX class the script uses becomes \s).
function shapeCheck(name) {
    const m = script.match(new RegExp(`\\[\\[ "\\$${name}" =~ (\\S+) \\]\\]`));
    assert.ok(m, `no =~ check on $${name} in ${UPDATER}`);
    return { source: m[1], regex: new RegExp(m[1].replaceAll('[:space:]', '\\s')) };
}

function assertInOrder(text, markers, where) {
    let from = 0;
    for (const marker of markers) {
        const at = text.indexOf(marker, from);
        assert.notEqual(at, -1, `${where}: ${JSON.stringify(marker)} is missing or out of order`);
        from = at + marker.length;
    }
}

test(`${UPDATER} runs its steps in the order the pages give`, () => {
    assertInOrder(script, [
        `installed_version=$(rpm -q --qf '%{VERSION}' "$PKG_NAME"`,
        'curl -fsSL',
        `jq -e 'type == "object"'`,
        '[ "$latest_version" = "$installed_version" ]',
        'curl -fsSL',
        'sha256sum "$rpm_path"',
        `rpm -qp --qf '%{NAME} %{VERSION}'`,
        'sudo dnf install -y "$rpm_path"',
        `now_installed=$(rpm -q --qf '%{VERSION}' "$PKG_NAME"`,
        'notify-send "$PKG_NAME updated"',
    ], UPDATER);
});

test(`${README} "How it works" lists the steps in the script's order`, () => {
    assertInOrder(howItWorks(), [
        '`rpm -q OpenAudible`',
        'swt_version.json',
        'must be a JSON object',
        "differs from what's installed",
        'downloads the rpm',
        'verifies its checksum',
        'rpm header names the expected package and version',
        '`sudo dnf install -y`',
        'Confirms with `rpm -q`',
        '`notify-send`',
    ], README);
});

test(`${AGENTS} "What this repo is" lists the steps in the script's order`, () => {
    assertInOrder(whatThisRepoIs(), [
        `\`rpm -q --qf '%{VERSION}' "$PKG_NAME"\``,
        '`curl` fetches the manifest',
        'must be a JSON object',
        'differs from the installed one',
        '`sha256sum`',
        `\`rpm -qp --qf '%{NAME} %{VERSION}'\``,
        '`sudo dnf install -y <rpm>`',
        're-reads `rpm -q`',
        '`notify-send`',
    ], AGENTS);
});

test('both pages give the manifest URL the script defaults to', () => {
    const url = script.match(/^: "\$\{VERSION_URL:=([^}]+)\}"$/m)?.[1];
    assert.ok(url, `no VERSION_URL default in ${UPDATER}`);
    assert.ok(howItWorks().includes(`\`${url}\``), README);
    assert.ok(whatThisRepoIs().includes(`\`${url}\``), AGENTS);
});

test('both downloads are https only, redirects included, as the pages say', () => {
    for (const options of [manifestCurl(), rpmCurl()]) {
        assert.equal(options['--proto'], '=https');
        assert.equal(options['--proto-redir'], '=https');
    }
    const readme = howItWorks();
    assert.match(readme, /swt_version\.json` over https only \(redirects included\)/);
    assert.match(readme, /downloads the rpm over https only/);
    const flags = '`--proto =https --proto-redir =https`';
    assert.equal(whatThisRepoIs().split(flags).length - 1, 2, `${AGENTS} gives ${flags} for both downloads`);
});

test(`${README} gives the manifest fetch's time limits`, () => {
    const options = manifestCurl();
    const m = howItWorks().match(
        /the manifest fetch gives up after (\d+) seconds without a connection or (\d+) seconds in total/
    );
    assert.ok(m, 'no manifest time limit sentence');
    assert.deepEqual([m[1], m[2]], [options['--connect-timeout'], options['--max-time']]);
});

test(`${README} gives the rpm download's time limits, and it has no total cap`, () => {
    const options = rpmCurl();
    const m = howItWorks().match(
        /the rpm download gives up after (\d+) seconds without a connection or if the transfer stays under (\d+) KiB\/s for (\d+) seconds, so a slow but moving download still finishes/
    );
    assert.ok(m, 'no rpm time limit sentence');
    assert.equal(m[1], options['--connect-timeout']);
    assert.equal(Number(m[2]) * 1024, Number(options['--speed-limit']));
    assert.equal(m[3], options['--speed-time']);
    assert.equal(options['--max-time'], undefined);
});

test('a failed download logs and exits 1, and a daily timer tries again', () => {
    assert.match(howItWorks(), /A failure logs and exits 1, and the next daily run tries again\./);
    for (const target of ['"$VERSION_URL" -o "$manifest"', '"${download_dir}${file_name}" -o "$rpm_path"']) {
        const lines = script.split('\n');
        const at = lines.findIndex((l) => l.startsWith('if ! curl') && l.includes(target));
        assert.notEqual(at, -1, target);
        assert.match(lines[at + 1], /^ {2}log "/);
        assert.equal(lines[at + 2], '  exit 1');
    }
    assert.match(read(TIMER), /^OnCalendar=daily$/m);
});

test('the version comparison is plain equality, as both pages say', () => {
    assert.doesNotMatch(script, /sort -V|rpmdev-vercmp|\brpm --eval\b/);
    assert.match(howItWorks(), /a plain comparison, not "newer"/);
    assert.match(whatThisRepoIs(), /string inequality, not a semver comparison/);
});

test('the nothing-to-do paths exit 0, as both pages say', () => {
    assert.match(script, /is not installed via rpm; nothing to do\."\n {2}exit 0\n/);
    assert.match(script, /is up to date \(installed: \$installed_version\)\."\n {2}exit 0\n/);
    assert.match(howItWorks(), /isn't installed via rpm, or is already current, the script exits cleanly/);
    assert.match(whatThisRepoIs(), /not installed via rpm -> log and exit 0/);
});

test('an install that did not take effect fails the run, as both pages say', () => {
    assert.match(script, /if \[ "\$now_installed" != "\$latest_version" \]; then\n[^\n]*\n {2}exit 1\n/);
    assert.match(howItWorks(), /If dnf exits 0 without installing it, the run fails instead\./);
    assert.match(whatThisRepoIs(), /it logs that the install did not take effect and exits 1/);
});

test('the file check takes a plain .rpm name and nothing else', () => {
    const { regex } = shapeCheck('file_name');
    assert.ok(regex.test('OpenAudible_4.7_x86_64.rpm'));
    for (const bad of ['../x.rpm', 'a/b.rpm', '.hidden.rpm', 'x.deb', 'x.rpm.sh', '']) {
        assert.ok(!regex.test(bad), bad);
    }
    assert.match(howItWorks(), /the file must be a plain `\.rpm` name/);
    assert.match(whatThisRepoIs(), /file a plain `\*\.rpm` name \(no `\/`, no leading `\.`\)/);
    assert.match(manifestFields(), /`file` must be a plain `\.rpm` name, with no `\/`/);
});

test('the sha256 check takes the length and case the pages give', () => {
    const { regex } = shapeCheck('expected_sha256');
    assert.ok(regex.test('a'.repeat(64)));
    for (const bad of ['a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), '']) {
        assert.ok(!regex.test(bad), bad);
    }
    assert.match(howItWorks(), /the `sha256` must be 64 hex characters/);
    assert.match(whatThisRepoIs(), /sha256 64 lowercase hex characters/);
    assert.match(manifestFields(), /`sha256` must be 64 lowercase hex characters/);
});

test('the download_dir check takes an https:// URL with a host', () => {
    const { regex } = shapeCheck('download_dir');
    assert.ok(regex.test('https://openaudible.org/latest/'));
    for (const bad of ['http://openaudible.org/', 'https:///dl/', 'https://host', 'https://a b/', '']) {
        assert.ok(!regex.test(bad), bad);
    }
    assert.match(howItWorks(), /`download_dir` must be an `https:\/\/` URL/);
    assert.match(whatThisRepoIs(), /`download_dir` an `https:\/\/` URL/);
    assert.match(manifestFields(), /`download_dir` must be an `https:\/\/` URL with a host/);
});

test(`${AGENTS} gives the version pattern the script uses`, () => {
    const { source } = shapeCheck('latest_version');
    assert.ok(whatThisRepoIs().includes(`version \`${source}\``), source);
});

test(`${SECURITY} "Manifest fields are untrusted" matches how the script reads them`, () => {
    const text = manifestFields();
    // Each field goes through jq's `strings`, so a missing or non-string value
    // reads as empty, and reaches a shape check before anything uses it.
    assert.match(script, /latest_version=\$\(jq -r '\.version \| strings' "\$manifest"\)/);
    assert.match(script, /download_dir=\$\(jq -r '\.download_dir \| strings' "\$manifest"\)/);
    assert.match(script, /'\.platforms\[\$k\]\? \| \.\[\$f\]\? \| strings'/);
    assert.match(text, /through `jq`'s `strings` filter, so a missing or non-string value reads as empty/);
    assert.ok(text.includes('`rpm_path="$WORKDIR/$file_name"`'));
    assert.ok(script.includes('rpm_path="$WORKDIR/$file_name"'));
    assert.ok(text.includes('`"${download_dir}${file_name}"`'));
    assert.ok(script.includes('"${download_dir}${file_name}"'));
    // Line numbers rot with every change to the script, and this section gives
    // no revision they would be true at.
    assert.doesNotMatch(text, /\bline \d+/);
});

test(`${SECURITY}'s rule against eval and bash -c holds in the script`, () => {
    assert.match(manifestFields(), /Never pass a manifest field to `eval`, to `bash -c`, or unquoted to a command/);
    const code = script.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    assert.doesNotMatch(code, /\beval\b|\bbash -c\b|\bsh -c\b/);
});
