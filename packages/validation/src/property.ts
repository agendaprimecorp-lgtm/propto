import { z } from 'zod';
import { UF, PhoneBR } from './organization';

/**
 * Contrato do imóvel. Fonte única (ADR-009): daqui saem os tipos, a
 * validação do formulário em etapas, a validação da API e o JSON Schema
 * entregue ao LLM na extração por voz (A2, docs/AI_AGENTS.md §4).
 *
 * Os `.describe()` NÃO são documentação: viram descrição de campo no
 * JSON Schema do modelo. Por isso estão em português e falam como o
 * corretor fala.
 */

export const PropertyStatus = z.enum([
  'rascunho',
  'em_processamento',
  'revisao',
  'publicado',
  'pausado',
  'vendido',
  'arquivado',
]);

export const PropertyPurpose = z.enum(['venda', 'locacao', 'venda_locacao']);

export const PropertyType = z.enum([
  'apartamento',
  'casa',
  'casa_condominio',
  'terreno',
  'chacara',
  'sitio',
  'fazenda',
  'sala_comercial',
  'loja',
  'galpao',
  'predio',
  'cobertura',
  'flat',
  'outro',
]);

export const AddressPrivacy = z.enum(['exato', 'rua', 'bairro']);
export const Furnished = z.enum(['nao', 'semi', 'sim']);
export const DeedStatus = z.enum(['escritura', 'matricula', 'contrato', 'inventario', 'outro']);
export const AuthorizationType = z.enum(['verbal', 'escrita', 'exclusiva']);

/** Espelha o CHECK de property_features: minúsculas, sem acento, com underline. */
export const FeatureKey = z.string().regex(/^[a-z0-9_]{2,40}$/);

export const CEP = z.string().regex(/^\d{8}$/, 'Informe o CEP com 8 dígitos, apenas números.');

/** Reais. Espelha numeric(14,2) — nunca float. */
const Money = z.number().finite().multipleOf(0.01);

export const PropertySchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  reference_code: z.string().regex(/^PRP-\d{6}$/),
  status: PropertyStatus,
  purpose: PropertyPurpose,
  type: PropertyType,

  title: z.string().trim().min(10).max(140).nullable(),
  description: z.string().max(4000).nullable(),
  highlights: z.array(z.string().max(80)).max(6),

  zip_code: CEP.nullable(),
  street: z.string().max(160).nullable(),
  number: z.string().max(20).nullable(),
  complement: z.string().max(80).nullable(),
  neighborhood: z.string().max(120).nullable(),
  city: z.string().min(2).max(120),
  state: z.enum(UF),
  address_privacy: AddressPrivacy,

  area_total: z.number().positive().max(100_000_000).nullable(),
  area_useful: z.number().positive().max(100_000_000).nullable(),
  area_land: z.number().positive().max(100_000_000).nullable(),
  bedrooms: z.number().int().min(0).max(30).nullable(),
  suites: z.number().int().min(0).max(30).nullable(),
  bathrooms: z.number().int().min(0).max(30).nullable(),
  parking_spots: z.number().int().min(0).max(50).nullable(),
  floor: z.number().int().min(-5).max(200).nullable(),
  units_per_floor: z.number().int().min(1).max(100).nullable(),
  year_built: z.number().int().min(1800).max(2100).nullable(),

  price: Money.positive().nullable(),
  rent_price: Money.positive().nullable(),
  condo_fee: Money.nonnegative().nullable(),
  iptu_year: Money.nonnegative().nullable(),
  accepts_trade: z.boolean(),
  accepts_financing: z.boolean(),
  furnished: Furnished,

  deed_status: DeedStatus.nullable(),
  restrictions: z.string().max(1000).nullable(),

  slug: z.string().nullable(),
  published_at: z.string().datetime({ offset: true }).nullable(),
  published_by: z.string().uuid().nullable(),
  cover_media_id: z.string().uuid().nullable(),

  ai_generated: z.boolean(),
  ai_confidence: z.number().min(0).max(1).nullable(),

  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  deleted_at: z.string().datetime({ offset: true }).nullable(),
});

/** Regras cruzadas — as mesmas que o banco impõe, para falhar antes da ida ao servidor. */
const crossFieldRules = <T extends z.ZodTypeAny>(schema: T) =>
  schema
    .refine((p: any) => p.suites == null || p.bedrooms == null || p.suites <= p.bedrooms, {
      message: 'O número de suítes não pode passar o de dormitórios.',
      path: ['suites'],
    })
    .refine(
      (p: any) => p.area_useful == null || p.area_total == null || p.area_useful <= p.area_total,
      { message: 'A área útil não pode ser maior que a área total.', path: ['area_useful'] },
    )
    .refine(
      (p: any) => p.purpose !== 'locacao' || p.rent_price != null || p.status === 'rascunho',
      { message: 'Informe o valor do aluguel.', path: ['rent_price'] },
    );

/** Campos que o cliente pode escrever. O resto é do servidor. */
export const PropertyWritableSchema = PropertySchema.omit({
  id: true,
  org_id: true,
  reference_code: true,
  status: true,
  slug: true,
  published_at: true,
  published_by: true,
  cover_media_id: true,
  ai_generated: true,
  ai_confidence: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
});

/** Criar: obrigatórios finalidade, tipo, cidade e UF; o restante entra aos poucos. */
export const PropertyCreateSchema = crossFieldRules(
  PropertyWritableSchema.partial().required({
    purpose: true,
    type: true,
    city: true,
    state: true,
  }),
);

/** Editar: tudo opcional — o formulário salva rascunho a cada etapa (PRP-203). */
export const PropertyUpdateSchema = crossFieldRules(PropertyWritableSchema.partial());

/**
 * Pré-condições de publicação. O banco também as impõe (constraint
 * `properties_publicado_completo`), mas aqui a mensagem é acionável:
 * diz ao corretor o que falta, campo a campo.
 */
export const PropertyPublishableSchema = PropertySchema.superRefine((p, ctx) => {
  if (!p.title)
    ctx.addIssue({ code: 'custom', path: ['title'], message: 'Dê um título ao anúncio.' });
  if (!p.description)
    ctx.addIssue({
      code: 'custom',
      path: ['description'],
      message: 'Escreva a descrição do imóvel.',
    });
  if (p.price == null && p.rent_price == null)
    ctx.addIssue({
      code: 'custom',
      path: ['price'],
      message: 'Informe o preço de venda ou o valor do aluguel.',
    });
});

export const PropertyOwnerSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  property_id: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  phone: PhoneBR.nullable(),
  email: z.string().email().nullable(),
  /** Apenas o ciphertext trafega. O documento em claro nunca chega ao banco. */
  document_enc: z.string().nullable(),
  authorization_type: AuthorizationType.nullable(),
  exclusive: z.boolean(),
  valid_until: z.string().date().nullable(),
  commission_pct: z.number().min(0).max(100).nullable(),
  notes: z.string().max(2000).nullable(),
});

/**
 * Transições permitidas — espelho de `property_status_allowed()` no banco.
 * Duplicação deliberada: a UI precisa saber o que oferecer antes de tentar.
 * O teste `tests/rls/sql/020_properties.sql` garante que os dois lados batem.
 */
export const ALLOWED_STATUS_TRANSITIONS: Record<
  z.infer<typeof PropertyStatus>,
  ReadonlyArray<z.infer<typeof PropertyStatus>>
> = {
  rascunho: ['em_processamento', 'revisao', 'publicado', 'arquivado'],
  em_processamento: ['revisao', 'rascunho', 'arquivado'],
  revisao: ['publicado', 'rascunho', 'arquivado'],
  publicado: ['pausado', 'vendido', 'arquivado', 'revisao'],
  pausado: ['publicado', 'vendido', 'arquivado'],
  vendido: ['arquivado'],
  arquivado: ['rascunho'],
} as const;

export function canTransition(
  from: z.infer<typeof PropertyStatus>,
  to: z.infer<typeof PropertyStatus>,
): boolean {
  return ALLOWED_STATUS_TRANSITIONS[from].includes(to);
}

export const STATUS_LABEL: Record<z.infer<typeof PropertyStatus>, string> = {
  rascunho: 'Rascunho',
  em_processamento: 'Processando',
  revisao: 'Em revisão',
  publicado: 'Publicado',
  pausado: 'Pausado',
  vendido: 'Vendido',
  arquivado: 'Arquivado',
};

export type Property = z.infer<typeof PropertySchema>;
export type PropertyCreate = z.infer<typeof PropertyCreateSchema>;
export type PropertyOwner = z.infer<typeof PropertyOwnerSchema>;
export type PropertyStatusValue = z.infer<typeof PropertyStatus>;
