import * as vscode from 'vscode';
import type { SupabaseClient } from '@supabase/supabase-js';

let cached: { url: string; key: string; client: SupabaseClient } | null = null;

/**
 * Lazily instantiates a Supabase client from the OWEN configuration. Returns null
 * when the Community Library is disabled or either credential is missing.
 *
 * The `@supabase/supabase-js` module is imported dynamically (not at module load)
 * so the extension activates even when the dependency is unavailable until a
 * Community Library command is actually invoked.
 */
export async function getSupabaseClient(): Promise<SupabaseClient | null> {
    const cfg = vscode.workspace.getConfiguration('owen');
    if (!cfg.get<boolean>('community.enabled', false)) return null;

    const url = (cfg.get<string>('supabase.url', '') || '').trim();
    const key = (cfg.get<string>('supabase.anonKey', '') || '').trim();
    if (!url || !key) return null;

    if (cached && cached.url === url && cached.key === key) {
        return cached.client;
    }
    try {
        const { createClient } = await import('@supabase/supabase-js');
        const client = createClient(url, key, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
        cached = { url, key, client };
        return client;
    } catch (err) {
        console.warn('[owen.community] failed to create Supabase client', err);
        return null;
    }
}
