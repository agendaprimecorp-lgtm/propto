import { z } from 'zod';

/**
 * Contratos de organização, perfil e vínculo.
 * Fonte única de verdade (ADR-009): daqui saem tipos, validação de
 * formulário, validação de API e fixtures de teste.
 */

export const UF = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
] as const;

export const OrgType = z.enum(['corretor_autonomo', 'imobiliaria']);
export const OrgPlan = z.enum(['free', 'corretor', 'corretor_pro', 'imobiliaria']);
export const OrgRole = z.enum(['owner', 'admin', 'corretor', 'assistente']);
export const MembershipStatus = z.enum(['ativo', 'convidado', 'suspenso']);
export const CreciStatus = z.enum(['pendente', 'verificado', 'recusado']);

/** Telefone brasileiro em E.164: +55 + DDD + 8 ou 9 dígitos. */
export const PhoneBR = z
  .string()
  .regex(/^\+55\d{10,11}$/, 'Informe o telefone com DDD, no formato +55 19 99999-9999.');

/** CPF (11) ou CNPJ (14), somente dígitos. A validação de dígito verificador vive em packages/utils. */
export const DocumentBR = z
  .string()
  .regex(/^\d{11}$|^\d{14}$/, 'Informe um CPF ou CNPJ válido, apenas números.');

export const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor no formato #RRGGBB.');

export const OrganizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2, 'O nome precisa de ao menos 2 caracteres.').max(120),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/),
  type: OrgType,
  document: DocumentBR.nullable(),
  phone: PhoneBR.nullable(),
  city: z.string().max(120).nullable(),
  state: z.enum(UF).nullable(),
  logo_url: z.string().url().nullable(),
  brand_color: HexColor,
  plan: OrgPlan,
  ai_budget_brl: z.number().nonnegative(),
  ai_spent_brl: z.number().nonnegative(),
  settings: z.record(z.string(), z.unknown()),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  deleted_at: z.string().datetime({ offset: true }).nullable(),
});

/** O que o cliente pode alterar. `plan`, `ai_budget_brl` e `ai_spent_brl` são do servidor. */
export const OrganizationUpdateSchema = OrganizationSchema.pick({
  name: true,
  document: true,
  phone: true,
  city: true,
  state: true,
  logo_url: true,
  brand_color: true,
}).partial();

export const ProfileSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().trim().min(2, 'Informe seu nome completo.').max(120),
  email: z.string().email().nullable(),
  phone: PhoneBR.nullable(),
  whatsapp: PhoneBR.nullable(),
  avatar_url: z.string().url().nullable(),
  creci: z
    .string()
    .trim()
    .regex(/^[0-9]{3,10}[-\s]?[A-Za-z]?$/, 'Informe o número do CRECI, ex.: 123456-F.')
    .nullable(),
  creci_state: z.enum(UF).nullable(),
  creci_status: CreciStatus,
  creci_doc_url: z.string().url().nullable(),
  bio: z.string().max(600, 'A bio pode ter no máximo 600 caracteres.').nullable(),
  cities: z.array(z.string().max(120)).max(30),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

/** `creci_status` só muda por back-office (PRP-106) — nunca pelo próprio corretor. */
export const ProfileUpdateSchema = ProfileSchema.pick({
  full_name: true,
  phone: true,
  whatsapp: true,
  avatar_url: true,
  creci: true,
  creci_state: true,
  creci_doc_url: true,
  bio: true,
  cities: true,
}).partial();

/** Publicar exige CRECI informado (RF-05). Usado por rpc/publish_property. */
export const PublishablePofileSchema = ProfileSchema.refine(
  (p) => Boolean(p.creci && p.creci_state),
  { message: 'Informe seu CRECI e a UF antes de publicar um imóvel.', path: ['creci'] },
);

export const MembershipSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: OrgRole,
  status: MembershipStatus,
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export type Organization = z.infer<typeof OrganizationSchema>;
export type OrganizationUpdate = z.infer<typeof OrganizationUpdateSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;
export type Membership = z.infer<typeof MembershipSchema>;
export type OrgRoleValue = z.infer<typeof OrgRole>;
