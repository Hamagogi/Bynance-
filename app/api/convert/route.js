import { NextResponse } from 'next/server';
import { withPlanGuard } from '@/lib/apiGuard';
import { incrementUsage } from '@/lib/usage';
import { getYoutubeTranscript } from '@/lib/extractors/youtube';
import { scrapeWebpage } from '@/lib/extractors/webpage';
import { generateRepurposedContent } from '@/lib/claude';

export const runtime = 'nodejs';
export const maxDuration = 60;

function detectSourceType(input) {
  const s = (input || '').trim();
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (u.hostname.includes('youtube.com') || u.hostname === 'youtu.be') {
        return 'youtube';
      }
      return 'url';
    } catch {
      return 'text';
    }
  }
  return 'text';
}

export const POST = withPlanGuard(
  async ({ req, user, supabase }) => {
    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const input = (body?.input || '').toString().trim();
    if (!input) return NextResponse.json({ error: 'Input is empty.' }, { status: 400 });
    if (input.length > 30000)
      return NextResponse.json(
        { error: 'Input is too large (30k char limit).' },
        { status: 400 }
      );

    const sourceType = detectSourceType(input);

    const { data: conversion, error: insertErr } = await supabase
      .from('conversions')
      .insert({
        user_id: user.id,
        source_type: sourceType,
        source_input: input,
        status: 'processing'
      })
      .select()
      .single();

    if (insertErr) {
      return NextResponse.json(
        { error: 'Could not create conversion.' },
        { status: 500 }
      );
    }

    try {
      let title = null;
      let content = input;
      if (sourceType === 'youtube') {
        const r = await getYoutubeTranscript(input);
        title = r.title;
        content = r.content;
      } else if (sourceType === 'url') {
        const r = await scrapeWebpage(input);
        title = r.title;
        content = r.content;
      } else {
        title = input.slice(0, 80);
      }

      const { outputs, usage } = await generateRepurposedContent({
        title,
        content,
        sourceType
      });

      await supabase
        .from('conversions')
        .update({
          status: 'done',
          source_title: title,
          source_content: content.slice(0, 20000),
          outputs,
          tokens_in: usage.input_tokens,
          tokens_out: usage.output_tokens
        })
        .eq('id', conversion.id);

      await incrementUsage(supabase, user.id);

      return NextResponse.json({ id: conversion.id, title, outputs });
    } catch (err) {
      const message = err?.message || 'Conversion failed.';
      await supabase
        .from('conversions')
        .update({ status: 'error', error_message: message })
        .eq('id', conversion.id);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  },
  { max: 10, windowMs: 60_000 }
);
