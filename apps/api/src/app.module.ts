import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { CommonModule } from './common/common.module';
import { AuthGuard } from './common/guards/auth.guard';
import { OrgGuard } from './common/guards/org.guard';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { AdminController } from './modules/admin/admin.controller';
import { AdminService } from './modules/admin/admin.service';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { BillingService } from './modules/billing/billing.service';
import { DeliveryController } from './modules/delivery/delivery.controller';
import { DeliveryService } from './modules/delivery/delivery.service';
import { DomainsController } from './modules/domains/domains.controller';
import { DomainsService } from './modules/domains/domains.service';
import { MailboxesController } from './modules/mailboxes/mailboxes.controller';
import { MailboxesService } from './modules/mailboxes/mailboxes.service';
import { MeController } from './modules/me/me.controller';
import { HealthController } from './modules/monitoring/health.controller';
import { InternalController } from './modules/monitoring/internal.controller';
import { MonitoringService } from './modules/monitoring/monitoring.service';
import { OrganizationsController } from './modules/organizations/organizations.controller';
import { OrganizationsService } from './modules/organizations/organizations.service';
import { WebmailController } from './modules/webmail/webmail.controller';
import { WebmailService } from './modules/webmail/webmail.service';

export const SERVICES = [AuthService, BillingService, DomainsService, MailboxesService, OrganizationsService, AdminService, DeliveryService, MonitoringService, WebmailService];

@Module({
  imports: [CommonModule],
  controllers: [AuthController, MeController, OrganizationsController, DomainsController, MailboxesController, WebmailController, AdminController, DeliveryController, HealthController, InternalController],
  providers: [
    ...SERVICES,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: OrgGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
