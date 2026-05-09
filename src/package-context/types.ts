export type ContextPackageArtifactKind =
  | 'source'
  | 'test'
  | 'documentation'
  | 'example'
  | 'story'
  | 'decision'
  | 'package_manifest'
  | 'api_surface'
  | 'changelog'
  | 'migration'
  | 'generated_context';

export type ContextPackageEdgeKind =
  | 'defines'
  | 'exports'
  | 'imports'
  | 'references'
  | 'calls_syntactic'
  | 'tests'
  | 'documents'
  | 'demonstrates'
  | 'decides'
  | 'deprecates'
  | 'migrates'
  | 'mentions'
  | 'changed_with';

export type ContextPackageConfidence = 'high' | 'medium' | 'low' | 'unsupported';

export interface ContextPackageSourceRef {
  file: string;
  startLine: number;
  endLine: number;
  reason: string;
}

export interface ContextPackageManifest {
  schemaVersion: 'ai-context-package.v0';
  generatedAt: string;
  generator: {
    name: 'codebase-context';
    feature: 'package-context';
  };
  package: {
    name: string;
    version?: string;
    description?: string;
    rootPath: string;
  };
  outputs: {
    readme: string;
    graph: {
      artifacts: string;
      symbols: string;
      edges: string;
      publicSurface: string;
    };
    packets: Record<string, string>;
    provenance: {
      sourceManifest: string;
      hashes: string;
      extractorReport: string;
    };
  };
  limits: {
    maxFileBytes: number;
    maxArtifacts: number;
  };
}

export interface ContextArtifactRecord {
  id: string;
  kind: ContextPackageArtifactKind;
  path: string;
  title: string;
  language: string;
  sizeBytes: number;
  hash: string;
  confidence: ContextPackageConfidence;
  evidence: ContextPackageSourceRef[];
  metadata: Record<string, unknown>;
}

export interface ContextSymbolRecord {
  id: string;
  name: string;
  kind: string;
  path: string;
  startLine: number;
  endLine: number;
  exported: boolean;
  confidence: ContextPackageConfidence;
  evidence: ContextPackageSourceRef[];
  metadata: Record<string, unknown>;
}

export interface ContextEdgeRecord {
  id: string;
  kind: ContextPackageEdgeKind;
  from: string;
  to: string;
  confidence: ContextPackageConfidence;
  evidence: ContextPackageSourceRef[];
  metadata: Record<string, unknown>;
}

export interface ContextPublicSurfaceRecord {
  id: string;
  name: string;
  kind: string;
  entrypoint?: string;
  path?: string;
  confidence: ContextPackageConfidence;
  evidence: ContextPackageSourceRef[];
  metadata: Record<string, unknown>;
}

export interface ContextPackageBuildOptions {
  rootPath: string;
  outDir: string;
  maxFileBytes?: number;
  maxArtifacts?: number;
}

export interface ContextPackageBuildResult {
  manifest: ContextPackageManifest;
  outDir: string;
  artifactCount: number;
  symbolCount: number;
  publicSurfaceCount: number;
  warningCount: number;
  warnings: string[];
}

export interface ContextPackageCheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  checkedFiles: number;
}

export interface ContextPackagePreview {
  packageName: string;
  version?: string;
  description?: string;
  artifactCount: number;
  publicSurfaceCount: number;
  warnings: string[];
  topPublicSurface: Array<{
    name: string;
    kind: string;
    confidence: ContextPackageConfidence;
    evidence: ContextPackageSourceRef[];
  }>;
}
