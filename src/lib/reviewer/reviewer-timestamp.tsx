'use client';

import { useEffect, useMemo, useState } from 'react';

export const REVIEWER_TIMESTAMP_EMPTY_LABEL = '—';
export const REVIEWER_TIMESTAMP_SOURCE = 'shared';

export type ReviewerTimestampState = 'empty' | 'invalid' | 'fallback' | 'local';

export interface ReviewerTimestampRenderValue {
    text: string;
    state: ReviewerTimestampState;
    dateTime?: string;
    title?: string;
}

export interface ReviewerTimestampFormatOptions {
    locale?: string;
    timeZone?: string;
}

export interface ReviewerTimestampProps extends ReviewerTimestampFormatOptions {
    value: string | null | undefined;
}

const REVIEWER_TIMESTAMP_FORMAT: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getReviewerTimestampFormatter({ locale = 'en-US', timeZone }: ReviewerTimestampFormatOptions) {
    const cacheKey = `${locale}::${timeZone ?? 'local'}`;
    const cached = formatterCache.get(cacheKey);

    if (cached) {
        return cached;
    }

    const formatter = new Intl.DateTimeFormat(locale, {
        ...REVIEWER_TIMESTAMP_FORMAT,
        ...(timeZone ? { timeZone } : {}),
    });

    formatterCache.set(cacheKey, formatter);
    return formatter;
}

export function formatReviewerTimestampLocal(value: string, options: ReviewerTimestampFormatOptions = {}) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    const parts = getReviewerTimestampFormatter(options).formatToParts(parsed);
    const values = new Map(parts.map((part) => [part.type, part.value]));
    const month = values.get('month');
    const day = values.get('day');
    const year = values.get('year');
    const hour = values.get('hour');
    const minute = values.get('minute');
    const dayPeriod = values.get('dayPeriod');

    if (month && day && year && hour && minute && dayPeriod) {
        return `${month} ${day}, ${year}, ${hour}:${minute} ${dayPeriod}`;
    }

    return getReviewerTimestampFormatter(options).format(parsed);
}

export function resolveReviewerTimestampRenderValue(
    value: unknown,
    options: ReviewerTimestampFormatOptions & { preferLocal?: boolean } = {}
): ReviewerTimestampRenderValue {
    if (value == null) {
        return {
            text: REVIEWER_TIMESTAMP_EMPTY_LABEL,
            state: 'empty',
        };
    }

    if (typeof value !== 'string') {
        return {
            text: REVIEWER_TIMESTAMP_EMPTY_LABEL,
            state: 'invalid',
        };
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return {
            text: value,
            state: 'invalid',
            title: value,
        };
    }

    if (!options.preferLocal) {
        return {
            text: value,
            state: 'fallback',
            dateTime: parsed.toISOString(),
            title: value,
        };
    }

    return {
        text: formatReviewerTimestampLocal(value, options),
        state: 'local',
        dateTime: parsed.toISOString(),
        title: value,
    };
}

export default function ReviewerTimestamp({ value, locale = 'en-US', timeZone }: ReviewerTimestampProps) {
    const [preferLocal, setPreferLocal] = useState(false);

    useEffect(() => {
        setPreferLocal(true);
    }, []);

    const renderValue = useMemo(
        () => resolveReviewerTimestampRenderValue(value, { locale, timeZone, preferLocal }),
        [locale, preferLocal, timeZone, value]
    );

    const sharedProps = {
        'data-reviewer-timestamp-source': REVIEWER_TIMESTAMP_SOURCE,
        'data-reviewer-timestamp-state': renderValue.state,
        ...(renderValue.title ? { title: renderValue.title } : {}),
    };

    if (renderValue.dateTime) {
        return (
            <time {...sharedProps} dateTime={renderValue.dateTime}>
                {renderValue.text}
            </time>
        );
    }

    return <span {...sharedProps}>{renderValue.text}</span>;
}
