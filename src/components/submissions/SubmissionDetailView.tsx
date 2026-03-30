'use client';

import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import {
    Box,
    Button,
    Chip,
    Divider,
    Paper,
    Stack,
    Typography,
} from '@mui/material';
import { useId, useState, type ReactNode } from 'react';
import ReviewerTimestamp from '@/lib/reviewer/reviewer-timestamp';
import type {
    SubmissionDetailAnswer,
    SubmissionDetailAttachment,
    SubmissionDetailQuestion,
    SubmissionDetailResponse,
} from '@/types/api';

export interface SubmissionDetailViewProps {
    detail: SubmissionDetailResponse;
}

function formatAnswer(answer: SubmissionDetailAnswer) {
    if (answer == null) {
        return null;
    }

    if (Array.isArray(answer)) {
        return answer.map((value) => String(value)).join(', ');
    }

    return String(answer);
}

function formatRawAnswer(rawAnswer: Record<string, unknown>) {
    return JSON.stringify(rawAnswer, null, 2);
}

function getAttachmentStatusLabel(status: SubmissionDetailAttachment['storage_status']) {
    switch (status) {
        case 'stored':
            return 'Stored';
        case 'unavailable':
            return 'Unavailable';
        case 'error':
            return 'Storage error';
    }
}

function getAttachmentStatusColor(status: SubmissionDetailAttachment['storage_status']) {
    switch (status) {
        case 'stored':
            return 'success' as const;
        case 'unavailable':
            return 'warning' as const;
        case 'error':
            return 'error' as const;
    }
}

function getAttachmentStatusDescription(status: SubmissionDetailAttachment['storage_status']) {
    switch (status) {
        case 'stored':
            return 'Durable storage succeeded for this attachment.';
        case 'unavailable':
            return 'Attachment metadata was captured, but the durable file is currently unavailable.';
        case 'error':
            return 'Attachment metadata was captured, but durable storage reported an error.';
    }
}

function MetadataField({
    label,
    value,
    monospace = false,
}: {
    label: string;
    value: ReactNode;
    monospace?: boolean;
}) {
    return (
        <Box>
            <Typography variant="caption" color="text.secondary" display="block">
                {label}
            </Typography>
            <Typography variant="body2" fontFamily={monospace ? 'monospace' : undefined}>
                {value}
            </Typography>
        </Box>
    );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
    return (
        <Paper variant="outlined" sx={{ px: 1.5, py: 1.25, minWidth: 120 }}>
            <Typography variant="caption" color="text.secondary" display="block">
                {label}
            </Typography>
            <Typography variant="h5" fontWeight={700}>
                {value}
            </Typography>
        </Paper>
    );
}

function AnswerStateChip({ question }: { question: SubmissionDetailQuestion }) {
    if (question.answerState === 'missing') {
        return <Chip label="Missing" color="warning" size="small" variant="outlined" />;
    }

    if (question.answer === null) {
        return <Chip label="Structured answer" color="info" size="small" variant="outlined" />;
    }

    return <Chip label="Answered" color="success" size="small" variant="outlined" />;
}

function QuestionAnswer({ question }: { question: SubmissionDetailQuestion }) {
    const formattedAnswer = formatAnswer(question.answer);

    if (question.answerState === 'missing') {
        return (
            <Typography variant="body2" color="warning.dark">
                No answer was submitted for this question.
            </Typography>
        );
    }

    if (formattedAnswer == null) {
        return (
            <Typography variant="body2" color="text.secondary">
                Structured answer recorded. Open raw payload to inspect the stored response.
            </Typography>
        );
    }

    return (
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {formattedAnswer}
        </Typography>
    );
}

function RawPayloadDisclosure({ question }: { question: SubmissionDetailQuestion }) {
    const [open, setOpen] = useState(false);
    const disclosureId = useId();

    if (!question.rawAnswer) {
        return null;
    }

    return (
        <Box>
            <Button
                size="small"
                variant="text"
                aria-expanded={open}
                aria-controls={disclosureId}
                startIcon={open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                onClick={() => setOpen((current) => !current)}
            >
                {open ? 'Hide raw payload' : 'Show raw payload'}
            </Button>
            {open ? (
                <Paper
                    id={disclosureId}
                    variant="outlined"
                    sx={{ mt: 1, p: 1.5, bgcolor: 'grey.50', overflowX: 'auto' }}
                >
                    <Typography component="pre" variant="body2" sx={{ m: 0, fontFamily: 'monospace' }}>
                        {formatRawAnswer(question.rawAnswer)}
                    </Typography>
                </Paper>
            ) : null}
        </Box>
    );
}

function AttachmentStatusChip({ attachment }: { attachment: SubmissionDetailAttachment }) {
    return (
        <Chip
            label={getAttachmentStatusLabel(attachment.storage_status)}
            color={getAttachmentStatusColor(attachment.storage_status)}
            size="small"
            variant="outlined"
        />
    );
}

function AttachmentCard({ attachment }: { attachment: SubmissionDetailAttachment }) {
    const statusLabel = getAttachmentStatusLabel(attachment.storage_status);
    const statusDescription = getAttachmentStatusDescription(attachment.storage_status);

    return (
        <Paper component="li" variant="outlined" sx={{ p: 2, listStyle: 'none' }}>
            <Stack spacing={1.5}>
                <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                    justifyContent="space-between"
                >
                    <Box minWidth={0}>
                        <Typography variant="subtitle1" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
                            {attachment.file_name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                            {attachment.media_type}
                        </Typography>
                    </Box>
                    <AttachmentStatusChip attachment={attachment} />
                </Stack>

                <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                    Storage status — {statusLabel}. {statusDescription}
                </Typography>
            </Stack>
        </Paper>
    );
}

function AttachmentSection({ attachments }: { attachments: SubmissionDetailAttachment[] }) {
    const headingId = useId();

    return (
        <Paper component="section" variant="outlined" sx={{ p: 2.5 }} aria-labelledby={headingId}>
            <Stack spacing={2}>
                <Box>
                    <Typography id={headingId} variant="h5" fontWeight={600}>
                        Attachments
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Reviewer-safe attachment metadata and durable storage status captured with this submission.
                    </Typography>
                </Box>

                {attachments.length === 0 ? (
                    <Typography color="text.secondary">
                        No attachments were included with this submission.
                    </Typography>
                ) : (
                    <Stack component="ul" spacing={1.5} sx={{ m: 0, p: 0 }} aria-label="Submission attachments">
                        {attachments.map((attachment) => (
                            <AttachmentCard key={attachment.id} attachment={attachment} />
                        ))}
                    </Stack>
                )}
            </Stack>
        </Paper>
    );
}

function QuestionCard({ question, index }: { question: SubmissionDetailQuestion; index: number }) {
    return (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Stack spacing={1.5}>
                <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                    justifyContent="space-between"
                >
                    <Box minWidth={0}>
                        <Typography variant="overline" color="text.secondary">
                            Question {index + 1}
                        </Typography>
                        <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>
                            {question.question_text}
                        </Typography>
                    </Box>
                    <AnswerStateChip question={question} />
                </Stack>

                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Chip label={question.external_id} size="small" variant="outlined" sx={{ fontFamily: 'monospace' }} />
                    {question.question_type ? <Chip label={question.question_type} size="small" variant="outlined" /> : null}
                </Stack>

                <Box>
                    <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                        Reviewer-readable answer
                    </Typography>
                    <QuestionAnswer question={question} />
                </Box>

                <RawPayloadDisclosure question={question} />
            </Stack>
        </Paper>
    );
}

export default function SubmissionDetailView({ detail }: SubmissionDetailViewProps) {
    return (
        <Stack spacing={3}>
            <Paper variant="outlined" sx={{ p: 2.5 }}>
                <Stack spacing={2.5}>
                    <Box>
                        <Typography variant="h4" fontWeight={700}>
                            Submission detail
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            Review one submission against the queue’s full ordered question set.
                        </Typography>
                    </Box>

                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} useFlexGap flexWrap="wrap">
                        <MetadataField label="Queue" value={detail.queue.queue_id} monospace />
                        <MetadataField label="Submission" value={detail.submission.external_id} monospace />
                        <MetadataField label="Task ID" value={detail.submission.labeling_task_id ?? '—'} monospace />
                        <MetadataField label="Submitted" value={<ReviewerTimestamp value={detail.submission.submitted_at} />} />
                        <MetadataField label="Captured" value={<ReviewerTimestamp value={detail.submission.created_at} />} />
                    </Stack>

                    <Divider />

                    <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap" aria-label="Submission summary counts">
                        <SummaryStat label="Total questions" value={detail.summary.totalQuestions} />
                        <SummaryStat label="Answered" value={detail.summary.answeredQuestions} />
                        <SummaryStat label="Missing" value={detail.summary.missingQuestions} />
                    </Stack>
                </Stack>
            </Paper>

            <AttachmentSection attachments={detail.attachments} />

            {detail.questions.length === 0 ? (
                <Paper variant="outlined" sx={{ p: 3 }}>
                    <Typography color="text.secondary">
                        This submission has no queue questions to review yet.
                    </Typography>
                </Paper>
            ) : (
                <Stack spacing={2}>
                    {detail.questions.map((question, index) => (
                        <QuestionCard key={question.id} question={question} index={index} />
                    ))}
                </Stack>
            )}
        </Stack>
    );
}
