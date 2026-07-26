import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { NestJsAnalyzer } from '../src/analyzers/nestjs/index';

const analyzer = new NestJsAnalyzer();
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe('NestJsAnalyzer', () => {
  it('detects NestJS files without claiming generic decorator files', () => {
    expect(
      analyzer.canAnalyze(
        '/tmp/app.controller.ts',
        'import { Controller } from "@nestjs/common";\n@Controller("health") export class HealthController {}'
      )
    ).toBe(true);
    expect(
      analyzer.canAnalyze(
        '/tmp/main.ts',
        'import { NestFactory } from "@nestjs/core";\nawait NestFactory.create(AppModule);'
      )
    ).toBe(true);
    expect(
      analyzer.canAnalyze(
        '/tmp/angular.service.ts',
        'import { Injectable } from "@angular/core";\n@Injectable() export class AngularService {}'
      )
    ).toBe(false);
  });

  it('extracts controller routes, DI dependencies, guards, and Swagger patterns', async () => {
    const content = `
import { Body, Controller, Delete, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiOAuth2, ApiTags } from "@nestjs/swagger";
import { PermissionsGuard } from "./permissions.guard";
import { PaymentsService } from "./payments.service";

@ApiTags("Payments")
@Controller("payments")
@UseGuards(AuthGuard("jwt"), PermissionsGuard)
export class PaymentsController {
  constructor(@Inject(PaymentsService) private readonly paymentsService: PaymentsService) {}

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.paymentsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.create(dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.paymentsService.remove(id);
  }
}
`;

    const result = await analyzer.analyze('/tmp/payments.controller.ts', content);
    const controller = result.components.find(
      (component) => component.name === 'PaymentsController'
    );

    expect(result.framework).toBe('nestjs');
    expect(controller).toMatchObject({
      componentType: 'controller',
      layer: 'presentation',
      dependencies: ['PaymentsService']
    });
    expect(controller?.metadata.nestjs).toMatchObject({
      type: 'controller',
      decorators: ['ApiTags', 'Controller', 'UseGuards'],
      routes: [
        { method: 'GET', path: '/payments/:id', handler: 'findOne' },
        { method: 'POST', path: '/payments', handler: 'create' },
        { method: 'DELETE', path: '/payments/:id', handler: 'remove' }
      ]
    });
    expect(result.metadata.detectedPatterns).toContainEqual({
      category: 'routing',
      name: 'REST routes'
    });
    expect(result.metadata.detectedPatterns).toContainEqual({
      category: 'security',
      name: 'Guards'
    });
    expect(result.metadata.detectedPatterns).toContainEqual({
      category: 'documentation',
      name: 'Swagger'
    });
  });

  it('extracts modules, services, gateways, and provider metadata', async () => {
    const content = `
import { Inject, Injectable, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { WebSocketGateway } from "@nestjs/websockets";

@Injectable()
export class WidgetBootstrapService {
  constructor(@Inject("API_CONFIG") private readonly config: ApiConfigService) {}
}

@WebSocketGateway({ cors: true })
export class RealtimeGateway {}

@Module({
  imports: [ConfigModule],
  providers: [WidgetBootstrapService, RealtimeGateway],
  exports: [WidgetBootstrapService],
})
export class WidgetBootstrapModule {}
`;

    const result = await analyzer.analyze('/tmp/widget-bootstrap.module.ts', content);

    expect(result.components.map((component) => component.componentType)).toEqual([
      'service',
      'gateway',
      'module'
    ]);
    expect(
      result.components.find((component) => component.name === 'WidgetBootstrapModule')?.metadata
        .nestjs
    ).toMatchObject({
      type: 'module',
      moduleMetadata: {
        imports: ['ConfigModule'],
        providers: ['WidgetBootstrapService', 'RealtimeGateway'],
        exports: ['WidgetBootstrapService']
      }
    });
    expect(result.metadata.detectedPatterns).toContainEqual({
      category: 'realtime',
      name: 'WebSockets'
    });
    expect(result.metadata.detectedPatterns).toContainEqual({
      category: 'modules',
      name: 'Nest modules'
    });
  });

  it('detects NestJS 11 metadata from package dependencies', async () => {
    const root = await createTempProject({
      name: 'nestjs-api',
      dependencies: {
        '@nestjs/common': '11.1.19',
        '@nestjs/core': '11.1.19',
        '@nestjs/platform-express': '11.1.19',
        '@nestjs/swagger': '11.4.2',
        '@nestjs/graphql': '13.3.0',
        '@nestjs/bullmq': '^11.0.4'
      },
      devDependencies: {
        '@nestjs/testing': '11.1.19',
        vitest: '^3.0.0'
      }
    });

    const metadata = await analyzer.detectCodebaseMetadata(root);

    expect(metadata.framework).toMatchObject({
      name: 'NestJS',
      version: '11.1.19',
      type: 'nestjs',
      variant: 'mixed'
    });
    expect(metadata.framework?.indicators).toEqual(
      expect.arrayContaining([
        'dep:@nestjs/common',
        'dep:@nestjs/core',
        'dep:@nestjs/platform-express'
      ])
    );
    expect(metadata.framework?.testingFrameworks).toEqual(['Nest Testing', 'Vitest']);
    expect(metadata.customMetadata.nestjs).toMatchObject({
      packages: expect.arrayContaining(['@nestjs/common', '@nestjs/core', '@nestjs/graphql'])
    });
  });

  it('detects older NestJS versions without version-specific assumptions', async () => {
    const root = await createTempProject({
      name: 'legacy-nest-api',
      dependencies: {
        '@nestjs/common': '^8.4.0',
        '@nestjs/core': '^8.4.0',
        '@nestjs/platform-express': '^8.4.0'
      }
    });

    const metadata = await analyzer.detectCodebaseMetadata(root);

    expect(metadata.framework?.type).toBe('nestjs');
    expect(metadata.framework?.version).toBe('8.4.0');
  });
});

async function createTempProject(packageJson: Record<string, unknown>): Promise<string> {
  const root = path.join(process.cwd(), 'tests', '.tmp', `nestjs-${randomUUID()}`);
  tempRoots.push(root);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(packageJson));
  return root;
}
