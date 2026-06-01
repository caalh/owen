import * as vscode from 'vscode';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let cached: { url: string; key: string; client: SupabaseClient } | null = null;

/**
 * Lazily instantiates a Supabase client from the OWEN configuration. Returns null
 * when the Community Library is disabled or either credential is missing.
 */
export function getSupabaseClient(): SupabaseClient | null {
    const cfg = vscode.workspace.getConfiguration('owen');
    if (!cfg.get<boolean>('community.enabled', false)) return null;

    const url = (cfg.get<string>('supabase.url', '') || '').trim();
    const key = (cfg.get<string>('supabase.anonKey', '') || '').trim();
    if (!url || !key) return null;

    if (cached && cached.url === url && cached.key === key) {
        return cached.client;
    }
    try {
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
