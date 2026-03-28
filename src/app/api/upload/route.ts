import { NextRequest, NextResponse } from 'next/server';
import { SubmissionFileSchema } from '@/lib/validators/upload';
import { persistSubmissions } from '@/lib/parsers/submission';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large. Maximum size is 10MB.' }, { status: 413 });
    }

    const text = await file.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON file' }, { status: 400 });
    }

    const parsed = SubmissionFileSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid submission format', details: parsed.error.issues },
        { status: 422 }
      );
    }

    const supabase = createServiceClient();
    const counts = await persistSubmissions(supabase, parsed.data);

    return NextResponse.json(counts);
  } catch (err) {
    console.error('Upload error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
