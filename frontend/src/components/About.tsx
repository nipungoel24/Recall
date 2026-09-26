import React, { useState, useEffect } from "react";
import { getVersion } from '@tauri-apps/api/app';
import Image from 'next/image';

/**
 * About Recall.
 *
 * Content is restricted to claims the PRD actually supports. Recall is a
 * local-first product, so this panel describes what the app does and how it
 * handles data — it is not a marketing surface and carries no calls to action.
 *
 * The open-source acknowledgement at the foot is retained because the upstream
 * project is MIT licensed and that licence requires the copyright notice to
 * travel with substantial portions of the software. It is presented as a legal
 * credit, not as product identity.
 */
export function About() {
    const [currentVersion, setCurrentVersion] = useState<string>('0.4.0');

    useEffect(() => {
        getVersion().then(setCurrentVersion).catch(console.error);
    }, []);

    const capabilities: Array<{ term: string; detail: string }> = [
        {
            term: 'Local first',
            detail: 'Recording, transcription, summaries and memory run on this machine by default.',
        },
        {
            term: 'Structured memory',
            detail: 'Decisions, questions, facts and action items are captured with links back to the moment they were said.',
        },
        {
            term: 'Provider choice',
            detail: 'Use a local model, or connect a cloud provider explicitly — the default never uploads meeting content.',
        },
        {
            term: 'Offline capable',
            detail: 'Capture and intelligence keep working without a network connection.',
        },
    ];

    return (
        <div className="space-y-5">
            {/* Identity */}
            <div className="flex items-start gap-3">
                <Image
                    src="/icon_128x128.png"
                    alt=""
                    width={40}
                    height={40}
                    className="mt-0.5 shrink-0 rounded-md border border-border"
                />
                <div className="min-w-0">
                    <h2 className="text-page-title text-foreground">Recall</h2>
                    <p className="text-caption text-muted-foreground">
                        Version {currentVersion}
                    </p>
                </div>
            </div>

            {/* Positioning — PRD statement of purpose */}
            <p className="text-body text-foreground border-l-2 border-border pl-3">
                A private, local-first meeting operating system that turns conversations
                into searchable memory and actionable work.
            </p>

            {/* Capabilities */}
            <section>
                <h3 className="text-label text-muted-foreground mb-2">What Recall does</h3>
                <dl className="divide-y divide-border border-y border-border">
                    {capabilities.map(({ term, detail }) => (
                        <div key={term} className="flex gap-3 py-2">
                            <dt className="w-32 shrink-0 text-sm font-medium text-foreground">
                                {term}
                            </dt>
                            <dd className="text-sm text-muted-foreground">{detail}</dd>
                        </div>
                    ))}
                </dl>
            </section>

            {/* Data handling */}
            <section>
                <h3 className="text-label text-muted-foreground mb-2">Your data</h3>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                    <li className="flex gap-2">
                        <span aria-hidden="true" className="text-foreground">—</span>
                        <span>Meeting audio, transcripts and notes are stored on this device.</span>
                    </li>
                    <li className="flex gap-2">
                        <span aria-hidden="true" className="text-foreground">—</span>
                        <span>
                            Nothing is sent to a cloud provider unless you configure one yourself.
                        </span>
                    </li>
                    <li className="flex gap-2">
                        <span aria-hidden="true" className="text-foreground">—</span>
                        <span>
                            Recall ships no product analytics. Diagnostics stay in local logs.
                        </span>
                    </li>
                </ul>
            </section>

            {/* Legal credit — required by the upstream MIT licence. */}
            <footer className="border-t border-border pt-3">
                <p className="text-caption text-muted-foreground">
                    Recall is derived from the Meetily open-source project (MIT licence).
                    Copyright (c) 2024 Zackriya Solutions.
                </p>
            </footer>
        </div>
    );
}
