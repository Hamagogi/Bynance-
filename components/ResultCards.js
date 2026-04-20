'use client';

import { useState } from 'react';

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
      className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Card({ title, children, copyText }) {
  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold">{title}</h3>
        {copyText ? <CopyButton text={copyText} /> : null}
      </div>
      <div className="space-y-2 text-sm leading-relaxed text-gray-800">{children}</div>
    </div>
  );
}

export default function ResultCards({ outputs }) {
  if (!outputs) return null;
  const ig = outputs.instagram || {};
  const tw = outputs.twitter || {};
  const li = outputs.linkedin || {};
  const yt = outputs.youtube_shorts || {};
  const nl = outputs.newsletter || {};

  const igFull = `${ig.caption || ''}\n\n${(ig.hashtags || []).join(' ')}`.trim();
  const twFull = (tw.tweets || []).map((t, i) => `${i + 1}/ ${t}`).join('\n\n');
  const ytFull = `${yt.hook || ''}\n\n${yt.script || ''}\n\nCTA: ${yt.cta || ''}`.trim();
  const nlFull = `Subject: ${nl.subject || ''}\n\n${nl.summary || ''}`.trim();

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card title="Instagram" copyText={igFull}>
        <p className="whitespace-pre-wrap">{ig.caption}</p>
        {ig.hashtags?.length ? (
          <p className="text-brand-600">{ig.hashtags.join(' ')}</p>
        ) : null}
      </Card>

      <Card title="X / Twitter thread" copyText={twFull}>
        <ol className="list-decimal space-y-2 pl-5">
          {(tw.tweets || []).map((t, i) => (
            <li key={i} className="whitespace-pre-wrap">
              {t}
            </li>
          ))}
        </ol>
      </Card>

      <Card title="LinkedIn post" copyText={li.post || ''}>
        <p className="whitespace-pre-wrap">{li.post}</p>
      </Card>

      <Card title="YouTube Shorts script" copyText={ytFull}>
        <p>
          <span className="font-semibold">Hook:</span> {yt.hook}
        </p>
        <p className="whitespace-pre-wrap">{yt.script}</p>
        <p>
          <span className="font-semibold">CTA:</span> {yt.cta}
        </p>
      </Card>

      <Card title="Newsletter" copyText={nlFull}>
        <p>
          <span className="font-semibold">Subject:</span> {nl.subject}
        </p>
        <p className="whitespace-pre-wrap">{nl.summary}</p>
      </Card>
    </div>
  );
}
