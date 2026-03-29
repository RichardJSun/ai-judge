import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SubmissionDetailResponse } from '@/types/api';
import SubmissionDetailView from './SubmissionDetailView';

function createDetailResponse(overrides: Partial<SubmissionDetailResponse> = {}): SubmissionDetailResponse {
    return {
        queue: {
            id: 'queue-1',
            queue_id: 'QUEUE-001',
            created_at: '2026-03-28T10:00:00.000Z',
        },
        submission: {
            id: 'submission-1',
            queue_id: 'queue-1',
            external_id: 'SUB-001',
            labeling_task_id: 'task-17',
            submitted_at: '2026-03-28T10:05:00.000Z',
            created_at: '2026-03-28T10:05:00.000Z',
        },
        summary: {
            totalQuestions: 4,
            answeredQuestions: 3,
            missingQuestions: 1,
        },
        questions: [
            {
                id: 'question-1',
                external_id: 'Q-001',
                question_type: 'short_text',
                question_text: 'Describe the main incident in one sentence.',
                created_at: '2026-03-28T10:01:00.000Z',
                answerState: 'answered',
                answer: 'A reviewer-readable scalar answer.',
                rawAnswer: { value: 'A reviewer-readable scalar answer.' },
            },
            {
                id: 'question-2',
                external_id: 'Q-002',
                question_type: 'multi_select',
                question_text:
                    'Select every policy area this submission touches, even when the prompt text is intentionally long enough to pressure horizontal layout and wrapping behavior in the question card.',
                created_at: '2026-03-28T10:02:00.000Z',
                answerState: 'answered',
                answer: ['policy', 'quality', 'ops'],
                rawAnswer: { value: ['policy', 'quality', 'ops'] },
            },
            {
                id: 'question-3',
                external_id: 'Q-003',
                question_type: 'json',
                question_text: 'Provide the structured metadata payload.',
                created_at: '2026-03-28T10:03:00.000Z',
                answerState: 'answered',
                answer: null,
                rawAnswer: {
                    value: { nested: true, score: 0.98 },
                    label: 'Structured payload',
                },
            },
            {
                id: 'question-4',
                external_id: 'Q-004',
                question_type: null,
                question_text: 'Optional follow-up that was left blank.',
                created_at: '2026-03-28T10:04:00.000Z',
                answerState: 'missing',
                answer: null,
                rawAnswer: null,
            },
        ],
        attachments: [],
        ...overrides,
    };
}

describe('SubmissionDetailView', () => {
    it('renders queue and submission metadata plus summary counts from the payload contract', () => {
        const html = renderToStaticMarkup(
            <SubmissionDetailView
                detail={createDetailResponse({
                    summary: {
                        totalQuestions: 9,
                        answeredQuestions: 7,
                        missingQuestions: 2,
                    },
                })}
            />
        );

        expect(html).toContain('Submission detail');
        expect(html).toContain('QUEUE-001');
        expect(html).toContain('SUB-001');
        expect(html).toContain('task-17');
        expect(html).toContain('Total questions');
        expect(html).toContain('Answered');
        expect(html).toContain('Missing');
        expect(html).toContain('>9<');
        expect(html).toContain('>7<');
        expect(html).toContain('>2<');
    });

    it('renders readable answered, structured-only, and missing states without inventing fallbacks', () => {
        const html = renderToStaticMarkup(<SubmissionDetailView detail={createDetailResponse()} />);

        expect(html).toContain('A reviewer-readable scalar answer.');
        expect(html).toContain('policy, quality, ops');
        expect(html).toContain('Structured answer recorded. Open raw payload to inspect the stored response.');
        expect(html).toContain('No answer was submitted for this question.');
        expect(html).toContain('Structured answer');
        expect(html).toContain('Missing');
    });

    it('shows raw-payload disclosure only for rows with rawAnswer and keeps raw content hidden by default', () => {
        const html = renderToStaticMarkup(<SubmissionDetailView detail={createDetailResponse()} />);

        expect(html.match(/Show raw payload/g)?.length).toBe(3);
        expect(html).not.toContain('Hide raw payload');
        expect(html).not.toContain('Structured payload');
        expect(html).not.toContain('&quot;nested&quot;');
    });

    it('renders an explicit no-attachments state instead of implying missing metadata', () => {
        const html = renderToStaticMarkup(<SubmissionDetailView detail={createDetailResponse()} />);

        expect(html).toContain('Attachments');
        expect(html).toContain('Reviewer-safe attachment metadata and durable storage status captured with this submission.');
        expect(html).toContain('No attachments were included with this submission.');
    });

    it('renders attachment filenames, media types, and truthful durable status copy without exposing storage internals', () => {
        const html = renderToStaticMarkup(
            <SubmissionDetailView
                detail={createDetailResponse({
                    attachments: [
                        {
                            id: 'attachment-1',
                            external_attachment_id: 'ATT-001',
                            source_kind: 'inline_base64',
                            file_name:
                                'this-is-a-very-long-reviewer-visible-filename-that-should-still-wrap-cleanly-without-pushing-the-layout-horizontally.pdf',
                            media_type: 'application/pdf',
                            byte_size: 1024,
                            storage_status: 'stored',
                            storage_error: null,
                        },
                        {
                            id: 'attachment-2',
                            external_attachment_id: 'ATT-002',
                            source_kind: 'inline_base64',
                            file_name: 'missing-reference.txt',
                            media_type: 'text/plain',
                            byte_size: 256,
                            storage_status: 'unavailable',
                            storage_error: 'submission-attachments/private/path.txt',
                        },
                        {
                            id: 'attachment-3',
                            external_attachment_id: 'ATT-003',
                            source_kind: 'inline_base64',
                            file_name: 'errored-image.png',
                            media_type: 'image/png',
                            byte_size: 2048,
                            storage_status: 'error',
                            storage_error: 'storage backend said no',
                        },
                    ],
                })}
            />
        );

        expect(html).toContain('Submission attachments');
        expect(html).toContain('application/pdf');
        expect(html).toContain('text/plain');
        expect(html).toContain('image/png');
        expect(html).toContain('Stored');
        expect(html).toContain('Unavailable');
        expect(html).toContain('Storage error');
        expect(html).toContain('Durable storage succeeded for this attachment.');
        expect(html).toContain('Attachment metadata was captured, but the durable file is currently unavailable.');
        expect(html).toContain('Attachment metadata was captured, but durable storage reported an error.');
        expect(html).toContain('this-is-a-very-long-reviewer-visible-filename-that-should-still-wrap-cleanly-without-pushing-the-layout-horizontally.pdf');
        expect(html).not.toContain('submission-attachments/private/path.txt');
        expect(html).not.toContain('storage backend said no');
        expect(html).not.toContain('ATT-001');
        expect(html).not.toContain('inline_base64');
    });

    it('renders an explicit empty-question state without any disclosure affordance', () => {
        const html = renderToStaticMarkup(
            <SubmissionDetailView
                detail={createDetailResponse({
                    questions: [],
                    summary: {
                        totalQuestions: 0,
                        answeredQuestions: 0,
                        missingQuestions: 0,
                    },
                })}
            />
        );

        expect(html).toContain('This submission has no queue questions to review yet.');
        expect(html).not.toContain('Show raw payload');
    });

    it('renders null optional submission metadata safely', () => {
        const html = renderToStaticMarkup(
            <SubmissionDetailView
                detail={createDetailResponse({
                    submission: {
                        id: 'submission-1',
                        queue_id: 'queue-1',
                        external_id: 'SUB-001',
                        labeling_task_id: null,
                        submitted_at: null,
                        created_at: '2026-03-28T10:05:00.000Z',
                    },
                })}
            />
        );

        expect(html).toContain('Task ID');
        expect(html).toContain('Submitted');
        expect(html.match(/>—</g)?.length).toBeGreaterThanOrEqual(2);
    });
});
