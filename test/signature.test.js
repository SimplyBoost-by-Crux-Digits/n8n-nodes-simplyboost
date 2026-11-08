'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');

const {
	parseSignatureHeader,
	verifySignature,
	SIGNATURE_TOLERANCE_SECONDS,
} = require('../dist/nodes/shared/signature');

const SECRET = 'whsec_test_secret';
const BODY =
	'{"id":"evt_1","type":"lead.captured","createdAt":"2026-11-08T10:00:00+00:00","data":{}}';
const NOW = 1_800_000_000;

// The server's signing (apps/public_api/tasks.sign), written out again here.
function serverSignature(secret, timestamp, body) {
	const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
	return `t=${timestamp},v1=${digest}`;
}

test('accepts the signature the server sends', () => {
	assert.equal(
		verifySignature(SECRET, serverSignature(SECRET, NOW, BODY), Buffer.from(BODY), NOW),
		true,
	);
});

test('accepts a raw body given as a string, and a header given as an array', () => {
	assert.equal(verifySignature(SECRET, [serverSignature(SECRET, NOW, BODY)], BODY, NOW), true);
});

test('refuses another secret, a changed body or a changed timestamp', () => {
	assert.equal(
		verifySignature('whsec_other', serverSignature(SECRET, NOW, BODY), BODY, NOW),
		false,
	);
	assert.equal(verifySignature(SECRET, serverSignature(SECRET, NOW, BODY), `${BODY} `, NOW), false);
	const header = serverSignature(SECRET, NOW, BODY).replace(`t=${NOW}`, `t=${NOW + 1}`);
	assert.equal(verifySignature(SECRET, header, BODY, NOW), false);
});

test('refuses a replay older than the tolerance, and one from the future', () => {
	const old = NOW - SIGNATURE_TOLERANCE_SECONDS - 1;
	assert.equal(verifySignature(SECRET, serverSignature(SECRET, old, BODY), BODY, NOW), false);
	const future = NOW + SIGNATURE_TOLERANCE_SECONDS + 1;
	assert.equal(verifySignature(SECRET, serverSignature(SECRET, future, BODY), BODY, NOW), false);
	const edge = NOW - SIGNATURE_TOLERANCE_SECONDS;
	assert.equal(verifySignature(SECRET, serverSignature(SECRET, edge, BODY), BODY, NOW), true);
});

test('refuses missing or malformed headers, a missing body and an empty secret', () => {
	for (const header of [
		undefined,
		'',
		'garbage',
		`t=${NOW}`,
		'v1=abc',
		`t=x,v1=${'a'.repeat(64)}`,
		`t=${NOW},v1=zz`,
	]) {
		assert.equal(verifySignature(SECRET, header, BODY, NOW), false, String(header));
	}
	assert.equal(verifySignature(SECRET, serverSignature(SECRET, NOW, BODY), undefined, NOW), false);
	assert.equal(verifySignature('', serverSignature('', NOW, BODY), BODY, NOW), false);
});

test('accepts any of several v1 signatures (secret rotation)', () => {
	const good = serverSignature(SECRET, NOW, BODY).split('v1=')[1];
	const header = `t=${NOW},v1=${'0'.repeat(64)},v1=${good}`;
	assert.equal(verifySignature(SECRET, header, BODY, NOW), true);
	assert.deepEqual(parseSignatureHeader(header).signatures.length, 2);
});
