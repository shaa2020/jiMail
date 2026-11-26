import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ClientIp, CurrentPrincipal, OrgRoles, Scopes } from '../../common/decorators';
import { Principal } from '../../common/principal';
import { ApiZodBody, zDomainName, zEmail, ZodPipe } from '../../common/zod';
import { DomainsService } from './domains.service';

const addSchema = z.object({ name: zDomainName });
const catchAllSchema = z.object({ address: zEmail.nullable() });

@ApiTags('domains')
@ApiBearerAuth()
@Controller('orgs/:orgId/domains')
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  @Get()
  @OrgRoles('MAILBOX_ADMIN')
  @Scopes('domains:read', 'domains:write')
  list(@Param('orgId') orgId: string) {
    return this.domains.list(orgId);
  }

  @Post()
  @OrgRoles('ADMIN')
  @Scopes('domains:write')
  @ApiZodBody(addSchema)
  @ApiOperation({ summary: 'Add a domain; returns the ownership TXT record to publish' })
  add(@Param('orgId') orgId: string, @Body(new ZodPipe(addSchema)) body: z.infer<typeof addSchema>, @CurrentPrincipal() p: Principal, @ClientIp() ip: string) {
    return this.domains.add(p, orgId, body.name, ip);
  }

  @Get(':id')
  @OrgRoles('MAILBOX_ADMIN')
  @Scopes('domains:read', 'domains:write')
  async get(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.domains.withInstructions(await this.domains.get(orgId, id));
  }

  @Get(':id/records')
  @OrgRoles('MAILBOX_ADMIN')
  @Scopes('domains:read', 'domains:write')
  @ApiOperation({ summary: 'DNS records to publish (from the mail server zone)' })
  records(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.domains.records(orgId, id);
  }

  @Post(':id/verify')
  @HttpCode(200)
  @OrgRoles('ADMIN')
  @Scopes('domains:write')
  @ApiOperation({ summary: 'Check the ownership TXT record and provision the domain on the mail server' })
  verify(@Param('orgId') orgId: string, @Param('id') id: string, @CurrentPrincipal() p: Principal, @ClientIp() ip: string) {
    return this.domains.verifyOwnership(p, orgId, id, ip);
  }

  @Post(':id/check')
  @HttpCode(200)
  @OrgRoles('MAILBOX_ADMIN')
  @Scopes('domains:write', 'domains:read')
  @ApiOperation({ summary: 'Re-run DNS checks (MX, SPF, DKIM, DMARC, ...)' })
  async check(@Param('orgId') orgId: string, @Param('id') id: string) {
    await this.domains.get(orgId, id);
    return this.domains.runChecks(id);
  }

  @Put(':id/catch-all')
  @OrgRoles('ADMIN')
  @Scopes('domains:write')
  @ApiZodBody(catchAllSchema)
  catchAll(@Param('orgId') orgId: string, @Param('id') id: string, @Body(new ZodPipe(catchAllSchema)) body: z.infer<typeof catchAllSchema>, @CurrentPrincipal() p: Principal, @ClientIp() ip: string) {
    return this.domains.setCatchAll(p, orgId, id, body.address, ip);
  }

  @Delete(':id')
  @OrgRoles('ADMIN')
  @Scopes('domains:write')
  remove(@Param('orgId') orgId: string, @Param('id') id: string, @CurrentPrincipal() p: Principal, @ClientIp() ip: string) {
    return this.domains.remove(p, orgId, id, ip);
  }
}
