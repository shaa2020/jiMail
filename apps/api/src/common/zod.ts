import { applyDecorators, BadRequestException, PipeTransform } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { z, ZodType } from 'zod';

export class ZodPipe<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    const r = this.schema.safeParse(value ?? {});
    if (!r.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return r.data;
  }
}

function jsonSchema(schema: ZodType): Record<string, any> {
  try {
    const s = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as Record<string, any>;
    delete s.$schema;
    return s;
  } catch {
    return { type: 'object' };
  }
}

/** Documents a zod schema as the OpenAPI request body. Use with @Body(new ZodPipe(schema)). */
export function ApiZodBody(schema: ZodType) {
  return applyDecorators(ApiBody({ schema: jsonSchema(schema) as any }));
}

export function ApiZodQuery(schema: z.ZodObject<any>) {
  const js = jsonSchema(schema);
  const props = (js.properties ?? {}) as Record<string, any>;
  const required: string[] = js.required ?? [];
  return applyDecorators(
    ...Object.entries(props).map(([name, s]) => ApiQuery({ name, required: required.includes(name), schema: s })),
  );
}

// Shared field schemas
export const zEmail = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const zPassword = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(256)
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), 'Password needs upper and lower case letters and a digit');
export const zDomainName = z
  .string()
  .trim()
  .toLowerCase()
  .transform((s) => s.replace(/\.$/, ''))
  .pipe(
    z
      .string()
      .max(253)
      .regex(/^(?=.{1,253}$)(?!-)([a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/, 'Enter a valid domain name such as example.com'),
  );
export const zLocalPart = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/, 'Use letters, digits, dot, dash, underscore or plus')
  .refine((s) => !s.includes('..'), 'Consecutive dots are not allowed');
export const zPage = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).optional(),
});
