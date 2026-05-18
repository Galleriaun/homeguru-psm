import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

type TemplateRow = Database['public']['Tables']['message_templates']['Row'];
type TemplateInsert = Database['public']['Tables']['message_templates']['Insert'];
type TemplateUpdate = Database['public']['Tables']['message_templates']['Update'];

export type MessageTemplate = TemplateRow;

/**
 * Variables supported by the template substitution helper. Template authors
 * insert these as `{misafir_adi}`, `{giris_tarihi}`, etc. Unknown tokens are
 * left as-is so a typo doesn't silently disappear.
 */
export const TEMPLATE_VARIABLES = [
  'misafir_adi',
  'giris_tarihi',
  'cikis_tarihi',
  'gece_sayisi',
  'toplam_tutar',
  'bakiye',
  'mulk_adi',
  'birim_adi',
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

const wrapErr = (e: { message: string; details?: string; hint?: string; code?: string }) =>
  new Error(
    `${e.message}${e.details ? ` — ${e.details}` : ''}${e.hint ? ` [${e.hint}]` : ''}${e.code ? ` (${e.code})` : ''}`,
  );

/** All message templates (everyone can read; RLS templates_select = USING(true)). */
export async function listTemplates(): Promise<TemplateRow[]> {
  const { data, error } = await supabase
    .from('message_templates')
    .select('*')
    .order('is_default', { ascending: false })
    .order('name', { ascending: true });
  if (error) throw wrapErr(error);
  return data ?? [];
}

export async function createTemplate(input: TemplateInsert): Promise<TemplateRow> {
  const { data, error } = await supabase
    .from('message_templates')
    .insert(input)
    .select()
    .single();
  if (error) throw wrapErr(error);
  return data;
}

export async function updateTemplate(
  id: string,
  input: TemplateUpdate,
): Promise<TemplateRow> {
  const { data, error } = await supabase
    .from('message_templates')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  if (error) throw wrapErr(error);
  return data;
}

export async function deleteTemplate(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('message_templates')
    .delete()
    .eq('id', id)
    .select();
  if (error) throw wrapErr(error);
  if (!data || data.length === 0) {
    throw new Error('Şablon silinemedi. Yetkiniz olmayabilir.');
  }
}

/**
 * Substitute `{var_name}` placeholders in template content using the
 * supplied map. Unknown placeholders are left as-is.
 */
export function substituteVariables(
  content: string,
  vars: Partial<Record<TemplateVariable, string>>,
): string {
  return content.replace(/\{(\w+)\}/g, (match, key) => {
    const v = (vars as Record<string, string | undefined>)[key];
    return v ?? match;
  });
}
