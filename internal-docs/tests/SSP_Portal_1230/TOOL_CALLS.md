Grok code +MCP/full:

get_codebase_metadata:
{
"status": "success",
"metadata": {
"name": "ssp-portal",
"framework": {
"name": "Angular",
"version": "20.3.15",
"type": "angular",
"variant": "unknown",
"stateManagement": [],
"uiLibraries": [
"Angular Material",
"PrimeNG"
],
"testingFrameworks": [
"Jest"
]
},
"languages": [],
"dependencies": [
{
"name": "@angular-extensions/elements",
"version": "^20.0.2",
"category": "other"
},
{
"name": "@angular/animations",
"version": "20.3.15",
"category": "framework"
},
{
"name": "@angular/cdk",
"version": "20.2.14",
"category": "framework"
},
{
"name": "@angular/common",
"version": "20.3.15",
"category": "framework"
},
{
"name": "@angular/core",
"version": "20.3.15",
"category": "framework"
},
{
"name": "@angular/elements",
"version": "20.3.15",
"category": "framework"
},
{
"name": "@angular/forms",
"version": "20.3.15",
"category": "framework"
},
{
"name": "@angular/material",
"version": "20.2.14",
"category": "framework"
},
{
"name": "@angular/platform-browser",
"version": "20.3.15",
"category": "framework"
},
{
"name": "@angular/platform-browser-dynamic",
"version": "20.3.15",
"category": "framework"
},
{
"name": "@angular/router",
"version": "20.3.15",
"category": "framework"
},
{
"name": "@codeblue/angular-banner",
"version": "^10.0.0",
"category": "other"
},
{
"name": "@codeblue/angular-multilanguage",
"version": "^35.0.0",
"category": "other"
},
{
"name": "@codeblue/angular-toolbar",
"version": "^24.0.0",
"category": "other"
},
{
"name": "@codeblue/angular-utils",
"version": "^17.0.0",
"category": "other"
},
{
"name": "@codeblue/core",
"version": "^4.10.2",
"category": "other"
},
{
"name": "@codeblue/prime",
"version": "^15.0.0",
"category": "other"
},
{
"name": "@codeblue/syncfusion",
"version": "^4.0.0",
"category": "other"
},
{
"name": "@grafana/faro-core",
"version": "^1.18.1",
"category": "other"
},
{
"name": "@grafana/faro-web-sdk",
"version": "^1.18.1",
"category": "other"
}
],
"architecture": {
"type": "feature-based",
"layers": {
"presentation": 73,
"business": 44,
"data": 4,
"state": 0,
"core": 3,
"shared": 0,
"feature": 0,
"infrastructure": 0,
"unknown": 43
},
"patterns": []
},
"projectStructure": {
"type": "single-app"
},
"statistics": {
"totalFiles": 744,
"totalLines": 65447,
"totalComponents": 127,
"componentsByType": {
"service": 48,
"component": 61,
"directive": 6,
"module": 2,
"interceptor": 2,
"pipe": 6,
"guard": 1,
"resolver": 1
},
"componentsByLayer": {
"presentation": 73,
"business": 44,
"data": 4,
"state": 0,
"core": 3,
"shared": 0,
"feature": 0,
"infrastructure": 0,
"unknown": 43
}
},
"teamPatterns": {
"dependencyInjection": {
"primary": {
"name": "inject() function",
"count": 104,
"frequency": "98%",
"examples": [
"core/guards/auth-guard.service.spec.ts"
],
"canonicalExample": {
"file": "core/guards/auth-guard.service.spec.ts",
"snippet": "beforeEach(() => {\n service = TestBed.inject(AuthGuard);\n routerService = TestBed.inject(RouterService);\n authService = TestBed.inject(AuthService);\n });"
},
"newestFileDate": "2025-11-03T12:17:38.000Z",
"trend": "Rising",
"guidance": "USE: inject() function – 98% adoption, rising"
},
"alsoDetected": [
{
"name": "Constructor injection",
"count": 2,
"frequency": "2%",
"newestFileDate": "2025-07-16T13:17:03.000Z",
"trend": "Stable",
"guidance": "CAUTION: Constructor injection – 2% minority pattern, stable"
}
]
},
"stateManagement": {
"primary": {
"name": "RxJS",
"count": 55,
"frequency": "52%",
"examples": [
"shared/adapters/widget-details.adapter.ts"
],
"canonicalExample": {
"file": "shared/adapters/widget-details.adapter.ts",
"snippet": "import { WidgetManagementService } from '../../widgets-management/services';\nimport { EMPTY, Observable, catchError, tap } from 'rxjs';\n\n@Directive()\nexport abstract class WidgetDetailsAdapter {"
},
"newestFileDate": "2025-11-03T12:17:38.000Z",
"trend": "Rising",
"guidance": "PREFER: RxJS – 52% adoption, rising"
},
"alsoDetected": [
{
"name": "Signals",
"count": 44,
"frequency": "42%",
"newestFileDate": "2025-11-03T12:17:38.000Z",
"trend": "Rising",
"guidance": "USE: Signals – 42%, rising (migration target)"
},
{
"name": "RxJS Subjects",
"count": 7,
"frequency": "7%",
"guidance": "CAUTION: RxJS Subjects – 7% minority pattern"
}
]
},
"componentInputs": {
"primary": {
"name": "Signal-based inputs",
"count": 30,
"frequency": "86%",
"examples": [
"lib/components/base-element.component.ts"
],
"canonicalExample": {
"file": "lib/components/base-element.component.ts",
"snippet": "/\n readonly isAdminMode = input(false);\n\n /\n * Whether the widget should show its settings"
},
"newestFileDate": "2025-11-03T12:17:38.000Z",
"trend": "Rising",
"guidance": "USE: Signal-based inputs – 86% adoption, rising"
},
"alsoDetected": [
{
"name": "Decorator-based @Input",
"count": 5,
"frequency": "14%",
"newestFileDate": "2025-11-03T12:17:38.000Z",
"trend": "Rising",
"guidance": "USE: Decorator-based @Input – 14%, rising (migration target)"
}
]
}
}
}
}


get_team_patterns query "all":

{
"status": "success",
"patterns": {
"unitTestFramework": {
"primary": {
"name": "Jest",
"count": 85,
"frequency": "65%",
"examples": [],
"guidance": "PREFER: Jest – 65% adoption"
},
"alsoDetected": [
{
"name": "Angular TestBed",
"count": 29,
"frequency": "22%",
"guidance": "Angular TestBed – 22%"
},
{
"name": "Generic Test",
"count": 16,
"frequency": "12%",
"guidance": "CAUTION: Generic Test – 12% minority pattern"
}
]
},
"testingFramework": {
"primary": {
"name": "Jest",
"count": 85,
"frequency": "70%",
"examples": [],
"guidance": "PREFER: Jest – 70% adoption"
},
"alsoDetected": [
{
"name": "Angular TestBed",
"count": 29,
"frequency": "24%",
"guidance": "Angular TestBed – 24%"
},
{
"name": "Playwright",
"count": 7,
"frequency": "6%",
"guidance": "CAUTION: Playwright – 6% minority pattern"
}
]
},
"testMocking": {
"primary": {
"name": "Spy-based mocking",
"count": 42,
"frequency": "51%",
"examples": [],
"guidance": "PREFER: Spy-based mocking – 51% adoption"
},
"alsoDetected": [
{
"name": "Jest mocks",
"count": 41,
"frequency": "49%",
"guidance": "Jest mocks – 49%"
}
]
},
"dependencyInjection": {
"primary": {
"name": "inject() function",
"count": 104,
"frequency": "98%",
"examples": [
"core/guards/auth-guard.service.spec.ts"
],
"canonicalExample": {
"file": "core/guards/auth-guard.service.spec.ts",
"snippet": "beforeEach(() => {\n service = TestBed.inject(AuthGuard);\n routerService = TestBed.inject(RouterService);\n authService = TestBed.inject(AuthService);\n });"
},
"newestFileDate": "2025-11-03T12:17:38.000Z",
"trend": "Rising",
"guidance": "USE: inject() function – 98% adoption, rising"
},
"alsoDetected": [
{
"name": "Constructor injection",
"count": 2,
"frequency": "2%",
"newestFileDate": "2025-07-16T13:17:03.000Z",
"trend": "Stable",
"guidance": "CAUTION: Constructor injection – 2% minority pattern, stable"
}
]
},
"componentStyle": {
"primary": {
"name": "Standalone",
"count": 60,
"frequency": "100%",
"examples": [
"src/app/app.component.ts"
],
"canonicalExample": {
"file": "src/app/app.component.ts",
"snippet": "@Component({\n standalone: true,\n selector: 'app-root',\n templateUrl: './app.component.html',\n imports: [LauncherComponent],"
},
"newestFileDate": "2025-11-03T12:17:38.000Z",
"trend": "Rising",
"guidance": "USE: Standalone – 100% adoption, rising"
}
},
"stateManagement": {
"primary": {
"name": "RxJS",
"count": 55,
"frequency": "52%",
"examples": [
"shared/adapters/widget-details.adapter.ts"
],
"canonicalExample": {
"file": "shared/adapters/widget-details.adapter.ts",
"snippet": "import { WidgetManagementService } from '../../widgets-management/services';\nimport { EMPTY, Observable, catchError, tap } from 'rxjs';\n\n@Directive()\nexport abstract class WidgetDetailsAdapter {"
},
"newestFileDate": "2025-11-03T12:17:38.000Z",
"trend": "Rising",
"guidance": "PREFER: RxJS – 52% adoption, rising"
},
"alsoDetected": [
{
"name": "Signals",
"count": 44,
"frequency": "42%",
"newestFileDate": "2025-11-03T12:17:38.000Z",
"trend": "Rising",
"guidance": "USE: Signals – 42%, rising (migration target)"
},
{
"name": "RxJS Subjects",
"count": 7,
"frequency": "7%",
"guidance": "CAUTION: RxJS Subjects – 7% minority pattern"
}
]
},
"reactivity": {
"primary": {
"name": "Computed",
"count": 15,
"frequency": "52%",
"examples": [
"shared/adapters/widget-details.adapter.ts"
],
"canonicalExample": {
"file": "shared/adapters/widget-details.adapter.ts",
"snippet": "readonly widgetDetails = computed<WidgetDetailsInterface>(() => {\n const selectedWidget = this.selectedWidget();\n if (!selectedWidget) return {} as WidgetDetailsInterface;\n return {"
},
"newestFileDate": "2025-11-03T12:17:38.000Z",
"trend": "Rising",
"guidance": "PREFER: Computed – 52% adoption, rising"
},
"alsoDetected": [
{
"name": "Effect",
"count": 14,
"frequency": "48%",
"newestFileDate": "2025-11-03T12:17:38.000Z",
"trend": "Rising",
"guidance": "USE: Effect – 48%, rising (migration target)"
}
]
},
"componentInputs": {
"primary": {
"name": "Signal-based inputs",
"count": 30,
"frequency": "86%",
"examples": [
"lib/components/base-element.component.ts"
],
"canonicalExample": {
"file": "lib/components/base-element.component.ts",
"snippet": "/\n readonly isAdminMode = input(false);\n\n /\n * Whether the widget should show its settings"
},
"newestFileDate": "2025-11-03T12:17:38.000Z",
"trend": "Rising",
"guidance": "USE: Signal-based inputs – 86% adoption, rising"
},
"alsoDetected": [
{
"name": "Decorator-based @Input",
"count": 5,
"frequency": "14%",
"newestFileDate": "2025-11-03T12:17:38.000Z",
"trend": "Rising",
"guidance": "USE: Decorator-based @Input – 14%, rising (migration target)"
}
]
},
"e2eFramework": {
"primary": {
"name": "Playwright",
"count": 7,
"frequency": "100%",
"examples": [],
"guidance": "USE: Playwright – 100% adoption"
}
}
},
"goldenFiles": [
{
"file": "components/main-toolbar/main-toolbar.component.ts",
"score": 6,
"patterns": {
"inject": true,
"signals": true,
"computed": true,
"effect": true,
"standalone": true,
"signalInputs": true
}
},
{
"file": "lib/components/base-element.component.ts",
"score": 5,
"patterns": {
"inject": true,
"signals": true,
"computed": false,
"effect": true,
"standalone": true,
"signalInputs": true
}
},
{
"file": "containers/settings/settings.component.ts",
"score": 5,
"patterns": {
"inject": true,
"signals": true,
"computed": false,
"effect": true,
"standalone": true,
"signalInputs": true
}
},
{
"file": "components/overlay-chat/overlay-chat.component.ts",
"score": 5,
"patterns": {
"inject": true,
"signals": true,
"computed": true,
"effect": false,
"standalone": true,
"signalInputs": true
}
},
{
"file": "components/navigation-menu/navigation-menu.component.ts",
"score": 5,
"patterns": {
"inject": true,
"signals": true,
"computed": true,
"effect": false,
"standalone": true,
"signalInputs": true
}
}
]
}

search_codebase query "user-settings OR settings component" limit 5:
{
"status": "success",
"results": [
{
"summary": "Angular component 'UserSettingsComponent' (selector: unknown).",
"snippet": " CodeBlueCardModule\n ],\n templateUrl: './user-settings.component.html',\n styleUrl: './user-settings.component.scss'\n})\nexport class UserSettingsComponent {\n private readonly crypto = globalThis.crypto;\n\n // Inputs\n readonly availableLanguages = input.required<LanguageOption[]>();\n readonly initialSettings = input<UserSettings>({\n language: 'en',\n theme: 'auto',\n notifications: {\n email: true,\n push: false,\n sms: false\n },\n profile: {\n firstName: '',\n lastName: '',\n email: ''\n }\n });\n\n // Outputs\n readonly settingsChange = output<UserSettings>();\n readonly save = output<UserSettings>();\n readonly cancel = output<void>();\n\n // Internal state signals\n private readonly currentSettings = signal<UserSettings>(this.initialSettings());\n\n // Computed properties\n readonly languageOptions = computed(() => {\n return this.availableLanguages().map(lang => ({\n label: lang.nativeName,\n value: lang.code\n }));\n });\n\n readonly themeOptions = computed(() => [\n { label: 'Light', value: 'light' as const },\n { label: 'Dark', value: 'dark' as const },\n { label: 'Auto', value: 'auto' as const }\n ]);\n\n readonly fullName = computed(() => {\n const profile = this.currentSettings().profile;\n const first = profile.firstName?.trim() || '';\n const last = profile.lastName?.trim() || '';\n return [first, last].filter(name => name).join(' ') || 'User';\n });\n\n readonly hasValidProfile = computed(() => {\n const profile = this.currentSettings().profile;\n return !!(profile.firstName?.trim() && profile.lastName?.trim() && profile.email?.trim());\n });\n\n readonly hasUnsavedChanges = computed(() => {\n const current = this.currentSettings();\n const initial = this.initialSettings();\n return JSON.stringify(current) !== JSON.stringify(initial);\n });\n\n // Public getters for template access\n get settings(): UserSettings {\n return this.currentSettings();\n }\n\n // Event handlers\n onLanguageChange(language: string): void {\n this.updateSettings({ language });\n }\n\n onThemeChange(theme: UserSettings['theme']): void {\n this.updateSettings({ theme });\n }\n\n onNotificationChange(type: keyof UserSettings['notifications'], enabled: boolean): void {\n this.updateSettings({\n notifications: {\n ...this.currentSettings().notifications,\n [type]: enabled\n }\n });\n }\n\n onProfileChange(field: keyof UserSettings['profile'], value: string): void {\n this.updateSettings({\n profile: {\n ...this.currentSettings().profile,\n [field]: value\n }\n });\n }\n\n onSave(): void {\n const settings = this.currentSettings();\n this.save.emit(settings);\n\n... [18 more lines]",
"filePath": "C:\\Users\\patrick.colom\\Repos\\SSP_Portal\\libs\\ui\\src\\lib\\components\\user-settings\\user-settings.component.ts:41-158",
"score": 0.44058388343321847,
"relevanceReason": "component; presentation layer; tags: component",
"componentType": "component",
"layer": "presentation",
"framework": "angular",
"trend": "Rising"
},
{
"summary": "TypeScript in user-settings.component.spec.ts.",
"snippet": "import { ComponentFixture, TestBed } from '@angular/core/testing';\nimport { FormsModule } from '@angular/forms';\nimport { TranslateModule, TranslateService } from '@ngx-translate/core';\nimport { UserSettingsComponent, UserSettings, LanguageOption } from './user-settings.component';\nimport { CodeBlueButtonModule } from '@codeblue/prime/button';\nimport { CodeBlueInputTextModule } from '@codeblue/prime/inputtext';\nimport { CodeBlueDropdownModule } from '@codeblue/prime/dropdown';\nimport { CodeBlueCheckboxModule } from '@codeblue/prime/checkbox';\nimport { CodeBlueCardModule } from '@codeblue/prime/card';\n\ndescribe('UserSettingsComponent', () => {\n let component: UserSettingsComponent;\n let fixture: ComponentFixture<UserSettingsComponent>;\n let translateService: TranslateService;\n\n const mockLanguages: LanguageOption[] = [\n { code: 'en', nativeName: 'English', id: 1 },\n { code: 'de', nativeName: 'Deutsch', id: 2 },\n { code: 'fr', nativeName: 'Français', id: 3 },\n { code: 'es', nativeName: 'Español', id: 4 }\n ];\n\n const defaultSettings: UserSettings = {\n language: 'en',\n theme: 'auto',\n notifications: {\n email: true,\n push: false,\n sms: false\n },\n profile: {\n firstName: 'John',\n lastName: 'Doe',\n email: 'john.doe@example.com'\n }\n };\n\n beforeEach(async () => {\n await TestBed.configureTestingModule({\n imports: [\n UserSettingsComponent,\n FormsModule,\n TranslateModule.forRoot(),\n CodeBlueButtonModule,\n CodeBlueInputTextModule,\n CodeBlueDropdownModule,\n CodeBlueCheckboxModule,\n CodeBlueCardModule\n ]\n }).compileComponents();\n\n fixture = TestBed.createComponent(UserSettingsComponent);\n component = fixture.componentInstance;\n translateService = TestBed.inject(TranslateService);\n\n // Mock translate service\n jest.spyOn(translateService, 'instant').mockImplementation(key => key);\n\n // Set required inputs\n fixture.componentRef.setInput('availableLanguages', mockLanguages);\n fixture.componentRef.setInput('initialSettings', defaultSettings);\n fixture.detectChanges();\n });\n\n it('should create', () => {\n expect(component).toBeTruthy();\n });\n\n describe('Initialization', () => {\n it('should initialize with provided settings', () => {\n expect(component.settings.language).toBe('en');\n expect(component.settings.theme).toBe('auto');\n expect(component.settings.notifications.email).toBe(true);\n expect(component.settings.profile.firstName).toBe('John');\n });\n\n it('should use default settings when none provided', () => {\n const freshFixture = TestBed.createComponent(UserSettingsComponent);\n const freshComponent = freshFixture.componentInstance;\n freshFixture.componentRef.setInput('availableLanguages', mockLanguages);\n // Don't set initialSettings\n freshFixture.detectChanges();\n\n expect(freshComponent.settings.language).toBe('en');\n expect(freshComponent.settings.theme).toBe('auto');\n expect(freshComponent.settings.notifications.email).toBe(true);\n });\n });\n\n describe('Computed Properties', () => {\n describe('languageOptions', () => {\n it('should transform available languages to dropdown options', () => {\n const options = component.languageOptions();\n expect(options).toEqual([\n { label: 'English', value: 'en' },\n { label: 'Deutsch', value: 'de' },\n { label: 'Français', value: 'fr' },\n { label: 'Español', value: 'es' }\n ]);\n });",
"filePath": "C:\\Users\\patrick.colom\\Repos\\SSP_Portal\\libs\\ui\\src\\lib\\components\\user-settings\\user-settings.component.spec.ts:1-100",
"score": 0.308202433817556,
"relevanceReason": "content match",
"trend": "Rising"
},
{
"summary": "TypeScript in user-settings.component.spec.ts.",
"snippet": "\n component.onSave();\n\n expect(saveSpy).toHaveBeenCalledWith(component.settings);\n });\n });\n\n describe('onCancel', () => {\n it('should reset settings to initial values and emit cancel', () => {\n const cancelSpy = jest.spyOn(component.cancel, 'emit');\n\n // Make some changes\n component.onLanguageChange('de');\n component.onThemeChange('dark');\n\n // Cancel\n component.onCancel();\n\n expect(component.settings).toEqual(defaultSettings);\n expect(cancelSpy).toHaveBeenCalled();\n });\n });\n });\n\n describe('Settings Integration', () => {\n it('should handle complex settings updates', () => {\n const settingsChangeSpy = jest.spyOn(component.settingsChange, 'emit');\n\n // Update multiple settings\n component.onLanguageChange('fr');\n component.onThemeChange('light');\n component.onNotificationChange('push', true);\n component.onNotificationChange('sms', true);\n component.onProfileChange('firstName', 'Marie');\n component.onProfileChange('lastName', 'Dubois');\n\n const expectedSettings: UserSettings = {\n language: 'fr',\n theme: 'light',\n notifications: {\n email: true,\n push: true,\n sms: true\n },\n profile: {\n firstName: 'Marie',\n lastName: 'Dubois',\n email: 'john.doe@example.com'\n }\n };\n\n expect(component.settings).toEqual(expectedSettings);\n expect(settingsChangeSpy).toHaveBeenCalledTimes(6);\n expect(settingsChangeSpy).toHaveBeenLastCalledWith(expectedSettings);\n });\n\n it('should maintain settings consistency after multiple operations', () => {\n // Make changes\n component.onLanguageChange('es');\n component.onNotificationChange('email', false);\n\n // Save\n component.onSave();\n\n // Make more changes\n component.onThemeChange('dark');\n component.onProfileChange('email', 'new.email@example.com');\n\n // Cancel\n component.onCancel();\n\n // Should be back to saved state\n expect(component.settings.language).toBe('es');\n expect(component.settings.notifications.email).toBe(false);\n expect(component.settings.theme).toBe('auto'); // Back to initial\n expect(component.settings.profile.email).toBe('john.doe@example.com'); // Back to initial\n });\n });\n\n describe('Template Integration', () => {\n it('should render profile information correctly', () => {\n fixture.detectChanges();\n\n const compiled = fixture.nativeElement;\n const profileHeader = compiled.querySelector('.profile-header h3');\n const profileEmail = compiled.querySelector('.profile-header small');\n\n expect(profileHeader.textContent.trim()).toBe('John Doe');\n expect(profileEmail.textContent.trim()).toBe('john.doe@example.com');\n });\n\n it('should render form fields', () => {\n fixture.detectChanges();\n\n const compiled = fixture.nativeElement;\n const firstNameInput = compiled.querySelector('#firstName');\n const languageDropdown = compiled.querySelector('#language');\n const emailCheckbox = compiled.querySelector('#email-notifications');\n\n expect(firstNameInput).toBeTruthy();",
"filePath": "C:\\Users\\patrick.colom\\Repos\\SSP_Portal\\libs\\ui\\src\\lib\\components\\user-settings\\user-settings.component.spec.ts:271-370",
"score": 0.266098559544948,
"relevanceReason": "content match",
"trend": "Stable"
},
{
"summary": "TypeScript in user-settings.component.spec.ts.",
"snippet": " describe('languageOptions', () => {\n it('should transform available languages to dropdown options', () => {\n const options = component.languageOptions();\n expect(options).toEqual([\n { label: 'English', value: 'en' },\n { label: 'Deutsch', value: 'de' },\n { label: 'Français', value: 'fr' },\n { label: 'Español', value: 'es' }\n ]);\n });\n });\n\n describe('themeOptions', () => {\n it('should return theme dropdown options', () => {\n const options = component.themeOptions();\n expect(options).toEqual([\n { label: 'Light', value: 'light' },\n { label: 'Dark', value: 'dark' },\n { label: 'Auto', value: 'auto' }\n ]);\n });\n });\n\n describe('fullName', () => {\n it('should combine first and last name', () => {\n expect(component.fullName()).toBe('John Doe');\n });\n\n it('should handle missing first name', () => {\n component.onProfileChange('firstName', '');\n expect(component.fullName()).toBe('Doe');\n });\n\n it('should handle missing last name', () => {\n component.onProfileChange('lastName', '');\n expect(component.fullName()).toBe('John');\n });\n\n it('should return \"User\" when both names are empty', () => {\n component.onProfileChange('firstName', '');\n component.onProfileChange('lastName', '');\n expect(component.fullName()).toBe('User');\n });\n });\n\n describe('hasValidProfile', () => {\n it('should return true when all profile fields are filled', () => {\n expect(component.hasValidProfile()).toBe(true);\n });\n\n it('should return false when first name is missing', () => {\n component.onProfileChange('firstName', '');\n expect(component.hasValidProfile()).toBe(false);\n });\n\n it('should return false when last name is missing', () => {\n component.onProfileChange('lastName', '');\n expect(component.hasValidProfile()).toBe(false);\n });\n\n it('should return false when email is missing', () => {\n component.onProfileChange('email', '');\n expect(component.hasValidProfile()).toBe(false);\n });\n });\n\n describe('hasUnsavedChanges', () => {\n it('should return false when no changes made', () => {\n expect(component.hasUnsavedChanges()).toBe(false);\n });\n\n it('should return true when settings changed', () => {\n component.onLanguageChange('de');\n expect(component.hasUnsavedChanges()).toBe(true);\n });\n\n it('should return false after canceling changes', () => {\n component.onLanguageChange('de');\n component.onCancel();\n expect(component.hasUnsavedChanges()).toBe(false);\n });\n });\n });\n\n describe('Event Handlers', () => {\n describe('onLanguageChange', () => {\n it('should update language and emit settingsChange', () => {\n const settingsChangeSpy = jest.spyOn(component.settingsChange, 'emit');\n\n component.onLanguageChange('de');\n\n expect(component.settings.language).toBe('de');\n expect(settingsChangeSpy).toHaveBeenCalledWith({\n ...defaultSettings,\n language: 'de'\n });\n });\n });\n\n describe('onThemeChange', () => {",
"filePath": "C:\\Users\\patrick.colom\\Repos\\SSP_Portal\\libs\\ui\\src\\lib\\components\\user-settings\\user-settings.component.spec.ts:91-190",
"score": 0.26444246561004553,
"relevanceReason": "content match",
"trend": "Stable"
},
{
"summary": "TypeScript in user-settings.component.spec.ts.",
"snippet": "\n expect(component.settings.language).toBe('de');\n expect(settingsChangeSpy).toHaveBeenCalledWith({\n ...defaultSettings,\n language: 'de'\n });\n });\n });\n\n describe('onThemeChange', () => {\n it('should update theme and emit settingsChange', () => {\n const settingsChangeSpy = jest.spyOn(component.settingsChange, 'emit');\n\n component.onThemeChange('dark');\n\n expect(component.settings.theme).toBe('dark');\n expect(settingsChangeSpy).toHaveBeenCalledWith({\n ...defaultSettings,\n theme: 'dark'\n });\n });\n });\n\n describe('onNotificationChange', () => {\n it('should update email notification setting', () => {\n const settingsChangeSpy = jest.spyOn(component.settingsChange, 'emit');\n\n component.onNotificationChange('email', false);\n\n expect(component.settings.notifications.email).toBe(false);\n expect(settingsChangeSpy).toHaveBeenCalledWith({\n ...defaultSettings,\n notifications: {\n ...defaultSettings.notifications,\n email: false\n }\n });\n });\n\n it('should update push notification setting', () => {\n const settingsChangeSpy = jest.spyOn(component.settingsChange, 'emit');\n\n component.onNotificationChange('push', true);\n\n expect(component.settings.notifications.push).toBe(true);\n expect(settingsChangeSpy).toHaveBeenCalledWith({\n ...defaultSettings,\n notifications: {\n ...defaultSettings.notifications,\n push: true\n }\n });\n });\n });\n\n describe('onProfileChange', () => {\n it('should update first name', () => {\n const settingsChangeSpy = jest.spyOn(component.settingsChange, 'emit');\n\n component.onProfileChange('firstName', 'Jane');\n\n expect(component.settings.profile.firstName).toBe('Jane');\n expect(settingsChangeSpy).toHaveBeenCalledWith({\n ...defaultSettings,\n profile: {\n ...defaultSettings.profile,\n firstName: 'Jane'\n }\n });\n });\n\n it('should update email', () => {\n const settingsChangeSpy = jest.spyOn(component.settingsChange, 'emit');\n\n component.onProfileChange('email', 'jane.doe@example.com');\n\n expect(component.settings.profile.email).toBe('jane.doe@example.com');\n expect(settingsChangeSpy).toHaveBeenCalledWith({\n ...defaultSettings,\n profile: {\n ...defaultSettings.profile,\n email: 'jane.doe@example.com'\n }\n });\n });\n });\n\n describe('onSave', () => {\n it('should emit save event with current settings', () => {\n const saveSpy = jest.spyOn(component.save, 'emit');\n\n component.onSave();\n\n expect(saveSpy).toHaveBeenCalledWith(component.settings);\n });\n });\n\n describe('onCancel', () => {\n it('should reset settings to initial values and emit cancel', () => {\n const cancelSpy = jest.spyOn(component.cancel, 'emit');",
"filePath": "C:\\Users\\patrick.colom\\Repos\\SSP_Portal\\libs\\ui\\src\\lib\\components\\user-settings\\user-settings.component.spec.ts:181-280",
"score": 0.262232237646175,
"relevanceReason": "content match",
"trend": "Stable"
}
],
"totalResults": 5
}


TOOL CALLS CLAUDE 4.5 HAIKU IN CURSOR:
GET_CODEBASE_METADATA - same response as above for Grok
GET_TEAM_PATTERNS query all - same response as above for Grok
SEARCH_CODEBASE query "feature component with signals and form" limit 5

"results": [
{
"summary": "TypeScript in widgets-management-overview.component.spec.ts.",
"snippet": "import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';\nimport { WidgetsManagementOverviewComponent } from './widgets-management-overview.component';\nimport { provideHttpClientTesting } from '@angular/common/http/testing';\nimport { WidgetManagementService, WidgetPackageService, PackageFiles } from '../../services';\nimport { mockVersion, mockWidgetFromRegistry, mockWidgetsFromRegistry } from '../../../shared/testing';\nimport { of, throwError } from 'rxjs';\nimport { TranslateModule } from '@ngx-translate/core';\nimport { By } from '@angular/platform-browser';\nimport type { MenuItemCommandEvent } from 'primeng/api';\nimport { provideToastr } from 'ngx-toastr';\nimport { PortalToastService, WithRequired, WidgetInterface, FeatureFlagsService, WebsiteService } from '@ssp/common';\nimport { HttpErrorResponse, provideHttpClient } from '@angular/common/http';\nimport { NoopAnimationsModule } from '@angular/platform-browser/animations';\nimport { Dialog, DialogPropsInterface } from '@ssp/ui';\nimport { Button } from '@syncfusion/ej2-angular-buttons';\nimport { BannerComponent } from '@codeblue/angular-banner';\nimport { WidgetsManagementOverviewInterface } from '../../models/widgets-management-overview.interface';\nimport { DebugElement, signal } from '@angular/core';\nimport { LanguageQuery } from '@ssp/utils';\nimport { CurrentLanguageService } from '@codeblue/angular-multilanguage';\nimport '@ssp/utils/testing';\n\nObject.defineProperty(window, 'matchMedia', {\n writable: true,\n value: jest.fn().mockImplementation(query => ({\n matches: false,\n media: query,\n onchange: null,\n addListener: jest.fn(), // deprecated\n removeListener: jest.fn(), // deprecated\n addEventListener: jest.fn(),\n removeEventListener: jest.fn(),\n dispatchEvent: jest.fn()\n }))\n});\n\ndescribe('WidgetsManagementOverviewComponent', () => {\n let component: WidgetsManagementOverviewComponent;\n let fixture: ComponentFixture<WidgetsManagementOverviewComponent>;\n let widgetManagementService: WidgetManagementService;\n let toastService: PortalToastService;\n let featureFlagsService: FeatureFlagsService;\n let dialog: Dialog;\n\n const detailsPanel = (): DebugElement | null =>\n fixture.debugElement.query(By.css('[data-testid=\"widget-management-details-panel\"]'));\n\n const usedVersionId = 'guid';\n const newVersionId = 'guid123';\n const widgetWithNewVersion = {\n ...mockWidgetFromRegistry,\n usedVersion: { ...mockVersion, number: '1.0.0' },\n versions: [\n { ...mockVersion, id: usedVersionId, number: '1.0.0' },\n { ...mockVersion, id: newVersionId, number: '2.0.0' }\n ]\n };\n\n const mockWidgets = mockWidgetsFromRegistry as WithRequired<WidgetInterface, 'latestVersion'>[];\n const mockWidgetById = { ...mockWidgetFromRegistry, id: 'widgetGuid123' } as WithRequired<\n WidgetInterface,\n 'versions'\n >;\n\n beforeEach(async () => {\n await TestBed.configureTestingModule({\n imports: [WidgetsManagementOverviewComponent, TranslateModule.forRoot(), NoopAnimationsModule],\n providers: [\n provideHttpClient(),\n provideHttpClientTesting(),\n provideToastr(),\n { provide: FeatureFlagsService, useValue: { getFeatureFlag: () => true } },\n {\n provide: WebsiteService,\n useValue: {\n languages: signal<LanguageQuery[]>([\n { id: 1, code: 'en', nativeName: 'English' },\n { id: 2, code: 'fr', nativeName: 'French' },\n { id: 3, code: 'de', nativeName: 'German' }\n ])\n }\n },\n CurrentLanguageService\n ]\n }).compileComponents();\n\n widgetManagementService = TestBed.inject(WidgetManagementService);\n fixture = TestBed.createComponent(WidgetsManagementOverviewComponent);\n component = fixture.componentInstance;\n toastService = TestBed.inject(PortalToastService);\n featureFlagsService = TestBed.inject(FeatureFlagsService);\n dialog = TestBed.inject(Dialog);\n fixture.detectChanges();\n });\n\n it('should create', () => {\n expect(component).toBeTruthy();\n });\n describe('Table tests', () => {\n it('should ngOnInit load widgets', () => {",
"filePath": "C:\\Users\\patrick.colom\\Repos\\SSP_Portal\\libs\\admin\\src\\lib\\widgets-management\\components\\widgets-management-overview\\widgets-management-overview.component.spec.ts:1-100",
"score": 0.02699327930530238,
"relevanceReason": "content match",
"trend": "Rising"
},
{
"summary": "Angular component 'ServiceConnectionModalComponent' (selector: unknown) with ngOnDestroy.",
"snippet": " CodeBlueToggleSwitchModule\n ],\n templateUrl: './service-connection-modal.component.html',\n styleUrl: './service-connection-modal.component.scss'\n})\nexport class ServiceConnectionModalComponent {\n protected readonly featureFlagsService = inject(FeatureFlagsService);\n private readonly fb = inject(FormBuilder);\n private readonly translateService = inject(CommonTranslationsService);\n private readonly serviceConnectionsService = inject(ServiceConnectionsService);\n readonly addConnection = output<ServiceConnection>();\n readonly editConnection = output<ServiceConnection>();\n readonly dialog = viewChild.required(DialogComponent);\n readonly helpersText = viewChildren(HelperTextDirective);\n\n readonly currentLang = this.translateService.currentLanguage;\n readonly isEditMode = signal(false);\n readonly serviceConnection = signal<ServiceConnection | undefined>(undefined);\n form: FormGroup;\n connectionModes: { view: string; value: SecurityMode }[] = [];\n availableModules: { view: string; value: ModuleEnumValue }[] = [];\n serviceConnections: ServiceConnection[] = [];\n readonly dropdownListFields = dropdownListFields;\n readonly securityModes = SecurityModes;\n\n constructor() {\n this.form = this.createForm();\n this.setAvailableModules();\n effect(() => {\n this.currentLang();\n this.setConnectionModes();\n });\n this.serviceConnectionsService.getServiceConnections().subscribe(serviceConnections => {\n this.serviceConnections = serviceConnections;\n });\n }\n\n openDialog(serviceConnection?: ServiceConnection): void {\n this.form = this.createForm();\n this.setupSecurityModeListener();\n\n if (serviceConnection) {\n this.setupEditMode(serviceConnection);\n } else {\n this.isEditMode.set(false);\n this.serviceConnection.set(undefined);\n }\n\n this.dialog().show();\n }\n\n closeDialog(): void {\n this.dialog().hide();\n }\n\n onDialogClose(): void {\n this.helpersText().forEach(helperText => helperText?.ngOnDestroy());\n this.isEditMode.set(false);\n this.serviceConnection.set(undefined);\n }\n\n saveConnection(): void {\n if (\n this.form.invalid ||\n this.nameExistsInModule(this.form.get('name')?.value, this.form.get('module')?.value)\n ) {\n this.form.markAllAsTouched();\n return;\n }\n const connection = this.buildServiceConnection();\n const existingConnection = this.serviceConnection();\n\n if (this.isEditMode() && existingConnection?.id) {\n this.editConnection.emit({ ...connection, id: existingConnection.id });\n } else {\n this.addConnection.emit(connection);\n }\n }\n\n get headers(): FormArray {\n return this.form.get('security.headers') as FormArray;\n }\n\n addHeader(): void {\n this.headers.push(this.createHeaderGroup());\n }\n\n addBearerTokenHeader(token?: string): void {\n this.headers.push(\n this.fb.group({\n key: ['Authorization'],\n value: [token ?? '', [Validators.required, this.bearerTokenValidator]]\n })\n );\n }\n\n createHeaderGroup(): FormGroup {\n return this.fb.group({\n key: ['', Validators.required],\n value: ['', Validators.required]\n\n... [143 more lines]",
"filePath": "C:\\Users\\patrick.colom\\Repos\\SSP_Portal\\libs\\admin\\src\\lib\\service-connections\\components\\service-connection-modal\\service-connection-modal.component.ts:42-284",
"score": 0.020492873169277812,
"relevanceReason": "component; presentation layer; tags: component, signals",
"componentType": "component",
"layer": "presentation",
"framework": "angular",
"trend": "Rising"
},
{
"summary": "Angular component 'PageModalComponent' (selector: unknown) with ngOnInit, ngOnChanges, ngOnDestroy.",
"snippet": " PortalButtonComponent,\n TranslateModule,\n UpperCasePipe\n ]\n})\nexport class PageModalComponent implements OnChanges, OnInit, OnDestroy {\n protected readonly origin = inject(AppConfigService).globals.baseUrl;\n private readonly rolesService = inject(RolesApiService);\n private readonly formBuilder = inject(FormBuilder);\n private readonly translateService = inject(TranslateService);\n private readonly themesService = inject(ThemesService);\n private readonly websiteService = inject(WebsiteService);\n private readonly translationApiService = inject(TranslationApiService);\n private readonly appConfigService = inject(AppConfigService);\n private readonly commonTranslationService = inject(CommonTranslationsService);\n private readonly ngZone = inject(NgZone);\n\n private readonly adminLanguageService = inject(AdminLanguageService);\n\n readonly dialog = viewChild<DialogComponent>('dialog');\n\n readonly fileUpload = viewChild.required<CBFileUploadComponent>('fileUpload');\n readonly page = model<PageManageInterface>({});\n readonly editPage = input.required<boolean>();\n readonly pagesList = input.required<PageManageInterface[]>();\n\n readonly closed = output<void>();\n readonly pageCreated = output<RouteInterface>();\n readonly pageEdited = output<PageManageInterface>();\n\n readonly urlPattern = '^[-a-z0-9äöüß.]+$';\n availableRoles: Role[] = [];\n readonly availableRolesFieldType: typeof dropdownListFields = { text: 'name', value: 'name' };\n availableHomepageRoles: Role[] = [];\n pagesUrlList: string[] = [];\n pageForm!: FormGroup;\n availableThemes!: DropdownListModel[];\n availableAdminLanguages: LanguageQuery[] = [];\n readonly dropdownListFields = dropdownListFields;\n\n readonly defaultTheme = { view: this.translateService.instant('default'), value: '0' } as DropdownListModel;\n\n private pageSnapshot: RouteInterface | undefined;\n private readonly destroyed$ = new Subject<void>();\n\n private _rolesLoaded = false;\n\n async ngOnInit(): Promise<void> {\n this.availableAdminLanguages = await this.adminLanguageService.loadAdminLanguageConfiguration();\n this.subscribeWebsiteConfiguration();\n\n this.loadAvailableRoles();\n\n this.themesService.getThemes().subscribe((themes: ThemeInterface[]) => {\n this.availableThemes = themes\n .map(theme => {\n return { view: theme.name, value: theme.id.toString() } as DropdownListModel;\n })\n .sort((a: DropdownListModel, b: DropdownListModel) => a.view.localeCompare(b.view));\n this.availableThemes.unshift(this.defaultTheme);\n });\n }\n\n ngOnDestroy(): void {\n this.destroyed$.next();\n this.destroyed$.complete();\n }\n\n ngOnChanges(changes: SimpleChanges): void {\n if (changes['page']) {\n // TODO Change to computed or linkedSignal\n this.pageSnapshot = { ...this.page() };\n this.pagesUrlList = this.retrievePageUrls();\n }\n }\n\n cancel(): void {\n this.closeModal();\n }\n\n save(): void {\n const page = this.page();\n if (!page) throw new Error('Failed to save the page because it is undefined');\n page.showInMenu = page.active ? page.showInMenu : false;\n\n if (this.pageForm.valid) {\n this.assignFormValuesToPage();\n const pageEventToEmit: OutputEmitterRef<RouteInterface> = this.editPage()\n ? this.pageEdited\n : this.pageCreated;\n pageEventToEmit.emit(page);\n this.closeModal();\n }\n }\n\n openModal(): void {\n this.loadAvailableRoles();\n this.onModalOpen();\n }\n\n\n... [369 more lines]",
"filePath": "C:\\Users\\patrick.colom\\Repos\\SSP_Portal\\apps\\admin\\src\\app\\admin\\page-management\\components\\page-modal\\page-modal.component.ts:73-541",
"score": 0.01934230068949552,
"relevanceReason": "component; presentation layer; tags: component",
"componentType": "component",
"layer": "presentation",
"framework": "angular",
"trend": "Rising"
},
{
"summary": "'MockCurrentLanguageService' defined in upload-widget-dialog.component.spec.ts.",
"snippet": " nativeName: 'English',\n id: 0\n },\n {\n code: 'de',\n nativeName: 'German',\n id: 1\n },\n {\n code: 'fr',\n nativeName: 'French',\n id: 2\n }\n ])\n }\n },\n {\n provide: CurrentLanguageService,\n useClass: class MockCurrentLanguageService {\n currentLanguage = signal('en');\n }\n }\n ]\n }).compileComponents();\n\n fixture = TestBed.createComponent(UploadWidgetDialogComponent);\n component = fixture.componentInstance;\n widgetManagementService = TestBed.inject(WidgetManagementService);\n toastService = TestBed.inject(PortalToastService);\n translateService = TestBed.inject(TranslateService);\n translationApiService = TestBed.inject(TranslationApiService);\n widgetPackageService = TestBed.inject(WidgetPackageService);\n jest.spyOn(translateService, 'instant').mockImplementation(key => key);\n fixture.detectChanges();\n });\n\n afterEach(() => {\n jest.clearAllMocks();\n fixture.destroy();\n });\n\n it('should create', () => {\n expect(component).toBeTruthy();\n });\n\n describe('autoTranslate', () => {\n const translationsMock: MultilanguageData[] = [\n { language: 'de', value: 'Hallo' },\n { language: 'fr', value: 'Bonjour' }\n ];\n\n it('should return an empty array and NOT call the API when text is blank', async () => {\n const spy = jest.spyOn(translationApiService, 'translate');\n const res = await component.autoTranslate('en', ' ', ['de']);\n expect(res).toEqual([]);\n expect(spy).not.toHaveBeenCalled();\n });\n\n it('should return an empty array and NOT call the API when targetLangs is empty', async () => {\n const spy = jest.spyOn(translationApiService, 'translate');\n const res = await component.autoTranslate('en', 'Hello', []);\n expect(res).toEqual([]);\n expect(spy).not.toHaveBeenCalled();\n });\n\n it('should call translationApiService.translate and resolve with its result', async () => {\n const spy = jest.spyOn(translationApiService, 'translate').mockReturnValue(of(translationsMock));\n\n const res = await component.autoTranslate('en', 'Hello', ['de', 'fr']);\n\n expect(spy).toHaveBeenCalledWith('Hello', ['de', 'fr']);\n expect(res).toEqual(translationsMock);\n });\n });\n\n describe('Helper Methods and CSS Classes', () => {\n beforeEach(fakeAsync(() => {\n component.openDialog();\n component.dialog().open.emit();\n tick();\n }));\n\n describe('getHelperVariant', () => {\n it('should return info when form is null', () => {\n component.uploadForm = null;\n expect(component.getHelperVariant('tagName')).toBe('info');\n });\n\n it('should return info when control is not touched', () => {\n expect(component.getHelperVariant('tagName')).toBe('info');\n });\n\n it('should return error when control is touched and invalid', () => {\n const control = component.uploadForm?.get('tagName');\n control?.markAsTouched();\n control?.setErrors({ required: true });\n expect(component.getHelperVariant('tagName')).toBe('error');\n });\n\n it('should return info when control is touched but valid', () => {",
"filePath": "C:\\Users\\patrick.colom\\Repos\\SSP_Portal\\libs\\admin\\src\\lib\\widgets-management\\components\\upload-widget-dialog\\upload-widget-dialog.component.spec.ts:91-190",
"score": 0.018349184754309855,
"relevanceReason": "content match",
"trend": "Stable"
},
{
"summary": "TypeScript in widgets-management-overview.component.spec.ts.",
"snippet": " .spyOn(widgetManagementService, 'getWidgets')\n .mockReturnValue(of([widgetWithVersions]));\n\n component.onEditSuccess();\n\n expect(refreshSpy).toHaveBeenCalled();\n });\n\n it('should handle error when refreshing widgets list after upload', () => {\n jest.spyOn(widgetManagementService, 'getWidgets').mockReturnValue(throwError(() => ({ status: 500 })));\n\n const errorSpy = jest.spyOn(toastService, 'error');\n\n component.onUploadSuccess();\n\n expect(errorSpy).toHaveBeenCalledWith('error_widgets_market_get');\n });\n\n it('should handle error when refreshing widgets list after edit', waitForAsync(() => {\n jest.spyOn(widgetManagementService, 'getWidgets').mockReturnValue(throwError(() => ({ status: 500 })));\n\n const errorSpy = jest.spyOn(toastService, 'error');\n\n component.onEditSuccess();\n\n expect(errorSpy).toHaveBeenCalledWith('error_widgets_market_get');\n }));\n\n it('should update widgets signal with new data on successful refresh', () => {\n const updatedWidget: WithRequired<WidgetInterface, 'latestVersion'> = {\n ...mockWidgetFromRegistry,\n id: 'privateWidgetGuid',\n name: 'Updated Widget',\n isPrivate: true,\n latestVersion: mockVersion,\n usedVersion: mockVersion,\n versions: [mockVersion]\n };\n const newWidgets: WithRequired<WidgetInterface, 'latestVersion'>[] = [updatedWidget];\n\n jest.spyOn(widgetManagementService, 'getWidgets').mockReturnValue(of(newWidgets));\n\n component.onEditSuccess();\n\n expect(component'widgets').toEqual(newWidgets);\n });\n });\n });\n\n describe('Import widget functionality', () => {\n let mockFile: File;\n\n beforeEach(() => {\n // Create mock file for testing\n mockFile = new File(['test content'], 'test-widget.zip', { type: 'application/zip' });\n });\n\n describe('split menu command - import from zip', () => {\n it('should reset file input value and trigger click when the import menu item is selected', () => {\n const inputEl = fixture.debugElement.query(By.css('input[type=\"file\"]'))\n .nativeElement as HTMLInputElement;\n const clickSpy = jest.spyOn(inputEl, 'click');\n\n component.splitMenuItems()[0].command?.({} as unknown as MenuItemCommandEvent);\n\n expect(inputEl.value).toBe('');\n expect(clickSpy).toHaveBeenCalled();\n });\n });\n\n describe('onToolbarImportSelected', () => {\n it('should open the dialog when a valid file is selected', () => {\n const mockEvent = {\n target: {\n files: [mockFile]\n }\n } as unknown as Event;\n\n // Spy on the private method indirectly through its effects\n const openDialogSpy = jest.spyOn(component.uploadWidgetDialog(), 'openDialog');\n\n component.onToolbarImportSelected(mockEvent);\n\n // Verify the dialog opens and import is called\n expect(openDialogSpy).toHaveBeenCalled();\n });\n\n it('should handle case when no files are selected', () => {\n const mockEvent = {\n target: {\n files: []\n }\n } as unknown as Event;\n\n const openDialogSpy = jest.spyOn(component.uploadWidgetDialog(), 'openDialog');\n const importZipSpy = jest.spyOn(component.uploadWidgetDialog(), 'importZip');\n\n component.onToolbarImportSelected(mockEvent);\n\n expect(openDialogSpy).not.toHaveBeenCalled();",
"filePath": "C:\\Users\\patrick.colom\\Repos\\SSP_Portal\\libs\\admin\\src\\lib\\widgets-management\\components\\widgets-management-overview\\widgets-management-overview.component.spec.ts:631-730",
"score": 0.017547931568665825,
"relevanceReason": "content match",
"trend": "Rising"
}
],
"totalResults": 5
}

TOOL CALL SEARCH_CODEBASE query settings component with form and reactive patterns limit 3:
{
"status": "success",
"results": [
{
"summary": "'markOverriddenSetters' defined in migrate-ng-19.ts.",
"snippet": " }\n }\n}\n\n// Mark overridden setters with a TODO comment to check their behavior.\nfunction markOverriddenSetters(cls: ClassDeclaration): void {\n const setters = cls.getSetAccessors();\n setters.forEach(setAccessor => {\n const name = setAccessor.getName();\n if (name in PROPERTY_MAP) {\n // Add a JSDoc comment to flag this setter for manual review.\n setAccessor.addJsDoc({\n description: TODO: Verify that the override of setter '${name}' is still correct after migration.\n });\n }\n });\n}\n\n// Transform the corresponding HTML template file.\nfunction transformTemplate(htmlPath: string): void {\n if (!fs.existsSync(htmlPath)) return;\n let content = fs.readFileSync(htmlPath, 'utf8');",
"filePath": "C:\\Users\\patrick.colom\\Repos\\SSP_Portal\\libs\\utils\\src\\shared\\tools\\migrate-ng-19.ts:227-248",
"score": 0.017599777288903194,
"relevanceReason": "content match",
"trend": "Stable"
},
{
"summary": "Angular component 'CBFileUploadComponent' (selector: unknown).",
"snippet": " selector: 'cb-file-upload',\n templateUrl: './cb-file-upload.component.html',\n styleUrls: ['./cb-file-upload.component.scss'],\n imports: [TextBoxModule, ShowTooltipIfTruncatedDirective]\n})\nexport class CBFileUploadComponent {\n readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');\n readonly textBox = viewChild.required<TextBoxComponent>('textBox');\n\n /\n * Flag to show or hide the file size next to the file name.\n /\n readonly showFileSize = input<boolean>(true);\n\n /\n * Label for the TextBox.\n /\n readonly label = input.required<string>();\n\n /\n * Flag to allow downloading the selected file.\n /\n readonly allowDownload = input<boolean>(false);\n\n /\n * Event emitted after the input value changes (excluding delete).\n /\n readonly fileChange = output<File | null>();\n\n /\n * Event emitted when the delete icon is clicked.\n /\n readonly delete = output<void>();\n\n /\n * The selected file object from the input.\n /\n file: File | null = null;\n\n textBoxValue = '';\n /\n * The CSS selector for the native input element inside the component.\n /\n protected readonly inputSelector = .e-textbox input[type=\"text\"][readonly];\n protected showFileActions = false;\n protected isFocused = false;\n\n onFileChange(event: Event): void {\n const file = (event.target as HTMLInputElement).files?.item(0);\n if (!file) return;\n this.file = file;\n this.fileChange.emit(file);\n this.setTextBoxValue();\n }\n\n /\n * Handles the delete icon click event.\n /\n onDelete(): void {\n this.file = null;\n this.showFileActions = false;\n this.fileInput().nativeElement.value = '';\n this.textBoxValue = '';\n this.delete.emit();\n }\n\n /\n * Downloads the selected file.\n /\n downloadFile(): void {\n if (!this.file) return;\n\n const url = URL.createObjectURL(this.file);\n const a = document.createElement('a');\n a.href = url;\n a.download = this.file.name;\n document.body.appendChild(a);\n a.click();\n document.body.removeChild(a);\n URL.revokeObjectURL(url);\n }\n\n /\n * Handles the mouseover event.\n * Will show the delete icon if there's any file selected.\n /\n onMouseOver(): void {\n this.showFileActions = !!this.file;\n }\n\n onMouseLeave(): void {\n this.showFileActions = this.isFocused && !!this.file;\n }\n\n onFocusIn(): void {\n this.isFocused = true;\n }\n\n onFocusOut(): void {\n this.isFocused = false;\n\n... [31 more lines]",
"filePath": "C:\\Users\\patrick.colom\\Repos\\SSP_Portal\\libs\\ui\\src\\lib\\components\\file-upload\\cb-file-upload.component.ts:7-137",
"score": 0.015983613961642683,
"relevanceReason": "component; presentation layer; tags: component",
"componentType": "component",
"layer": "presentation",
"framework": "angular",
"trend": "Stable"
},
{
"summary": "'removeDestroyCalls' defined in migrate-ng-19.ts.",
"snippet": " if (method) method.rename(newName);\n }\n}\n\n// Remove calls to this.destroy() in the class.\nfunction removeDestroyCalls(cls: ClassDeclaration): void {\n const methods = cls.getInstanceMethods();\n for (const method of methods) {\n const body = method.getBody();\n if (!body) continue;\n const bodyText = body.getText();\n if (bodyText.includes('this.destroy()')) {\n const newText = bodyText.replace(/this\\.destroy\\s\\\s*\\\s;?/g, '');\n body.replaceWithText(newText);\n method.addJsDoc({\n description: TODO: Check if this.destroy() call can be safely removed (cleanup is automatic).\n });\n }\n }\n}\n\n// Mark overridden setters with a TODO comment to check their behavior.\nfunction markOverriddenSetters(cls: ClassDeclaration): void {\n const setters = cls.getSetAccessors();\n setters.forEach(setAccessor => {",
"filePath": "C:\\Users\\patrick.colom\\Repos\\SSP_Portal\\libs\\utils\\src\\shared\\tools\\migrate-ng-19.ts:210-234",
"score": 0.015685118959402233,
"relevanceReason": "content match",
"trend": "Stable"
}
],
"totalResults": 3
}


TOOL CALL search_codebase query "reactive form with FormBuilder and FormGroup standalone component" limit 3 filters "layer: presentation" "framework: angular" 
{
"status": "success",
"results": [],
"totalResults": 0
}