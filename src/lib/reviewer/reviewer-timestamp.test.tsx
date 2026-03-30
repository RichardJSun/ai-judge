import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ReviewerTimestamp, {
    formatReviewerTimestampLocal,
    resolveReviewerTimestampRenderValue,
    REVIEWER_TIMESTAMP_EMPTY_LABEL,
    REVIEWER_TIMESTAMP_SOURCE,
} from './reviewer-timestamp';

const KNOWN_TIMESTAMP = '2026-03-28T10:05:00.000Z';

describe('formatReviewerTimestampLocal', () => {
    it('formats one shared reviewer-visible timestamp contract when the browser-local timezone is known', () => {
        expect(formatReviewerTimestampLocal(KNOWN_TIMESTAMP, { timeZone: 'UTC' })).toBe('Mar 28, 2026, 10:05 AM');
        expect(formatReviewerTimestampLocal(KNOWN_TIMESTAMP, { timeZone: 'America/New_York' })).toBe('Mar 28, 2026, 6:05 AM');
    });

    it('keeps timezone-aware instants truthful instead of reinterpreting them as local wall-clock strings', () => {
        expect(formatReviewerTimestampLocal('2026-03-28T06:05:00.000-04:00', { timeZone: 'UTC' })).toBe('Mar 28, 2026, 10:05 AM');
        expect(formatReviewerTimestampLocal('2026-03-28T10:05:00.000Z', { timeZone: 'UTC' })).toBe('Mar 28, 2026, 10:05 AM');
    });
});

describe('resolveReviewerTimestampRenderValue', () => {
    it('renders a deterministic SSR fallback until browser-local time is safe to show', () => {
        expect(resolveReviewerTimestampRenderValue(KNOWN_TIMESTAMP)).toEqual({
            text: KNOWN_TIMESTAMP,
            state: 'fallback',
            dateTime: KNOWN_TIMESTAMP,
            title: KNOWN_TIMESTAMP,
        });

        expect(
            resolveReviewerTimestampRenderValue(KNOWN_TIMESTAMP, {
                preferLocal: true,
                timeZone: 'UTC',
            })
        ).toEqual({
            text: 'Mar 28, 2026, 10:05 AM',
            state: 'local',
            dateTime: KNOWN_TIMESTAMP,
            title: KNOWN_TIMESTAMP,
        });
    });

    it('normalizes null, invalid strings, and helper misuse into reviewer-safe fallbacks', () => {
        expect(resolveReviewerTimestampRenderValue(null)).toEqual({
            text: REVIEWER_TIMESTAMP_EMPTY_LABEL,
            state: 'empty',
        });

        expect(resolveReviewerTimestampRenderValue('not-a-real-timestamp')).toEqual({
            text: 'not-a-real-timestamp',
            state: 'invalid',
            title: 'not-a-real-timestamp',
        });

        expect(resolveReviewerTimestampRenderValue(1234)).toEqual({
            text: REVIEWER_TIMESTAMP_EMPTY_LABEL,
            state: 'invalid',
        });
    });
});

describe('ReviewerTimestamp', () => {
    it('renders SSR-safe fallback markup with one observable shared-source contract', () => {
        const html = renderToStaticMarkup(<ReviewerTimestamp value={KNOWN_TIMESTAMP} />);

        expect(html).toContain(`data-reviewer-timestamp-source="${REVIEWER_TIMESTAMP_SOURCE}"`);
        expect(html).toContain('data-reviewer-timestamp-state="fallback"');
        expect(html).toContain(`dateTime="${KNOWN_TIMESTAMP}"`);
        expect(html).toContain(`title="${KNOWN_TIMESTAMP}"`);
        expect(html).toContain(`>${KNOWN_TIMESTAMP}</time>`);
    });

    it('renders reviewer-safe placeholders for null and invalid values instead of crashing the page', () => {
        const emptyHtml = renderToStaticMarkup(<ReviewerTimestamp value={null} />);
        const invalidHtml = renderToStaticMarkup(<ReviewerTimestamp value={'not-a-real-timestamp'} />);

        expect(emptyHtml).toContain(`>${REVIEWER_TIMESTAMP_EMPTY_LABEL}</span>`);
        expect(emptyHtml).toContain('data-reviewer-timestamp-state="empty"');
        expect(invalidHtml).toContain('>not-a-real-timestamp</span>');
        expect(invalidHtml).toContain('data-reviewer-timestamp-state="invalid"');
    });
});
