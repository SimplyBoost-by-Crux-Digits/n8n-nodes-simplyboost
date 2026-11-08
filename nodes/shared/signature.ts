import { createHmac, timingSafeEqual } from 'crypto';

/**
 * SimplyBoost signs every webhook in the `SimplyBoost-Signature` header:
 * `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the endpoint's secret>`.
 * Each delivery attempt is signed again, so an old timestamp means a replay.
 */
export const SIGNATURE_HEADER = 'simplyboost-signature';
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export interface ParsedSignature {
	timestamp: number;
	signatures: string[];
}

export function parseSignatureHeader(header: unknown): ParsedSignature | undefined {
	const value = Array.isArray(header) ? header[0] : header;
	if (typeof value !== 'string' || !value) return undefined;
	let timestamp: number | undefined;
	const signatures: string[] = [];
	for (const part of value.split(',')) {
		const index = part.indexOf('=');
		if (index < 1) continue;
		const key = part.slice(0, index).trim();
		const item = part.slice(index + 1).trim();
		if (key === 't' && /^\d{1,12}$/.test(item)) timestamp = Number(item);
		if (key === 'v1' && /^[0-9a-f]{64}$/i.test(item)) signatures.push(item.toLowerCase());
	}
	if (timestamp === undefined || signatures.length === 0) return undefined;
	return { timestamp, signatures };
}

export function expectedSignature(
	secret: string,
	timestamp: number,
	rawBody: Buffer | string,
): string {
	const hmac = createHmac('sha256', secret);
	hmac.update(`${timestamp}.`);
	hmac.update(rawBody);
	return hmac.digest('hex');
}

/** Whether `header` is a valid, recent signature of `rawBody` with `secret`. */
export function verifySignature(
	secret: string,
	header: unknown,
	rawBody: Buffer | string | undefined,
	nowSeconds: number,
): boolean {
	if (!secret || rawBody === undefined) return false;
	const parsed = parseSignatureHeader(header);
	if (!parsed) return false;
	if (Math.abs(nowSeconds - parsed.timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
	const expected = Buffer.from(expectedSignature(secret, parsed.timestamp, rawBody), 'hex');
	return parsed.signatures.some((signature) => {
		const given = Buffer.from(signature, 'hex');
		return given.length === expected.length && timingSafeEqual(given, expected);
	});
}
