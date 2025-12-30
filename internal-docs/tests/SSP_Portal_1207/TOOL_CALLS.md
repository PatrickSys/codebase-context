#### TOOL CALL GPT-5.1-HIGH GET_CODEBASE_METADATA

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
        "presentation": 72,
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
      "totalFiles": 740,
      "totalLines": 64535,
      "totalComponents": 126,
      "componentsByType": {
        "service": 48,
        "component": 60,
        "directive": 6,
        "module": 2,
        "interceptor": 2,
        "pipe": 6,
        "guard": 1,
        "resolver": 1
      },
      "componentsByLayer": {
        "presentation": 72,
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
            "snippet": "beforeEach(() => {\n        service = TestBed.inject(AuthGuard);\n        routerService = TestBed.inject(RouterService);\n        authService = TestBed.inject(AuthService);\n    });"
          }
        },
        "alsoDetected": [
          {
            "name": "Constructor injection",
            "count": 2,
            "frequency": "2%"
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
          }
        },
        "alsoDetected": [
          {
            "name": "Signals",
            "count": 43,
            "frequency": "41%"
          },
          {
            "name": "RxJS Subjects",
            "count": 7,
            "frequency": "7%"
          }
        ]
      },
      "componentInputs": {
        "primary": {
          "name": "Signal-based inputs",
          "count": 29,
          "frequency": "85%",
          "examples": [
            "lib/components/base-element.component.ts"
          ],
          "canonicalExample": {
            "file": "lib/components/base-element.component.ts",
            "snippet": "*/\n    readonly isAdminMode = input(false);\n\n    /**\n     * Whether the widget should show its settings"
          }
        },
        "alsoDetected": [
          {
            "name": "Decorator-based @Input",
            "count": 5,
            "frequency": "15%"
          }
        ]
      }
    }
  }
}




################### TOOL CALL GPT-5.1-HIGH SEARCH_CODEBASE query user settings component
{
  "status": "success",
  "results": [
    {
      "summary": "Angular component 'SettingsComponent' (selector: unknown) with ngOnInit.",
      "snippet": "        FormsModule,\n        MultilanguageDropdownComponent,\n        RecordToMultilanguageDataPipe\n    ]\n})\nexport class SettingsComponent implements OnInit {\n    private readonly changeDetectorRef = inject(ChangeDetectorRef);\n    private readonly translate = inject(TranslateService);\n\n    customTransTitle: { [key: string]: string } = {\n        de: '',\n        en: '',\n        fr: '',\n        it: '',\n        nl: ''\n    };\n    _language = 'en';\n    readonly optionItems: string[] = ['en', 'de', 'fr', 'it', 'nl'];\n\n    @Input()\n    configuration!: WidgetConfigInterface<ContainerConfiguration>;\n\n    @Input()\n    availableLanguages: LanguageQuery[] = [];\n\n    @Input()\n    set language(language: string) {\n        this._language = language;\n    }\n\n    @Output()\n    translationUpdated: EventEmitter<UpdateTranslation> = new EventEmitter<UpdateTranslation>();\n\n    @Output()\n    selectedLanguageUpdated: EventEmitter<string> = new EventEmitter<string>();\n\n    @Output()\n    save: EventEmitter<WidgetConfigInterface<ContainerConfiguration>> = new EventEmitter<\n        WidgetConfigInterface<ContainerConfiguration>\n    >();\n\n    @Output()\n    cancel: EventEmitter<void> = new EventEmitter<void>();\n\n    ngOnInit() {\n        this.mapTitleToLocalProperty();\n    }\n\n    cancelConfiguration() {\n        this.cancel.emit();\n    }\n\n    customTransTitleChange(event: MultilanguageData[]) {\n        this.customTransTitle = toMultilanguageRecord(event);\n\n        this.availableLanguages.forEach(({ code }) => {\n            this.configuration.customTrans![code]['title'] =\n                this.customTransTitle[code] ?? '';\n        });\n    }\n\n    urlChange(event: MultilanguageData[]) {\n        this.configuration.customConfig.url = toMultilanguageRecord(event);\n    }\n\n    saveConfiguration() {\n        this.save.emit(this.configuration);\n    }\n\n    updateSelectedLanguage(lang: string) {\n        this.selectedLanguageUpdated.emit(lang);\n        this.changeDetectorRef.detectChanges();\n    }\n\n    private mapTitleToLocalProperty() {\n        if (this.configuration?.customTrans) {\n            this.availableLanguages.forEach(({ code }) => {\n                if (!this.configuration.customTrans?.[code]) {\n                    this.configuration.customTrans![code] = {};\n                }\n                this.customTransTitle[code] =\n                    this.configuration.customTrans![code]?.['title'] ?? '';\n            });\n        }\n    }\n}\n",
      "filePath": "C:\\Users\\patrick.colom\\Repos\\SSP_Portal\\widgets\\container-widget\\src\\app\\containers\\settings\\settings.component.ts:31-117",
      "score": 0.28824477750265487,
      "relevanceReason": "component; presentation layer; tags: component",
      "componentType": "component",
      "layer": "presentation",
      "framework": "angular"
    },
    {
      "summary": "Angular component 'SettingsComponent' (selector: unknown) with ngOnInit.",
      "snippet": "        FormsModule,\n        RecordToMultilanguageDataPipe\n    ],\n    providers: [TranslateService]\n})\nexport class SettingsComponent implements OnInit {\n    private readonly changeDetectorRef = inject(ChangeDetectorRef);\n    private readonly translateService = inject(TranslateService);\n    @Input()\n    configuration!: WidgetConfigInterface<FreeContentCustomConfig>;\n    @Input()\n    language = 'en';\n\n    @Output()\n    save: EventEmitter<WidgetConfigInterface<FreeContentCustomConfig>> = new EventEmitter<\n        WidgetConfigInterface<FreeContentCustomConfig>\n    >();\n\n    @Output()\n    cancel: EventEmitter<void> = new EventEmitter<void>();\n\n    @Output()\n    selectedLanguageUpdated: EventEmitter<string> = new EventEmitter<string>();\n\n    readonly availableLanguages = input.required<LanguageQuery[]>();\n\n    customTransTitle: Record<string, string> & { [key: string]: string } = {\n        de: '',\n        en: '',\n        fr: '',\n        it: '',\n        nl: ''\n    };\n\n    readonly translations = input.required<LanguageTransInterface>();\n\n    constructor() {\n        effect(() => {\n            for (const [langCode, translations] of Object.entries(this.translations())) {\n                this.translateService.setTranslation(langCode, translations, true);\n            }\n            // Kind of workaround to set default language, this should be done in a better way\n            const fallbackLang = this.translations()[this.language.split('-')[0]] ? this.language.split('-')[0] : 'en';\n            this.translateService.setFallbackLang(fallbackLang);\n        });\n    }\n\n    ngOnInit(): void {\n        this.translateService.use(this.language);\n        this.mapTitleTrans();\n    }\n\n    updateSelectedLanguage(lang: string): void {\n        this.selectedLanguageUpdated.emit(lang);\n        this.changeDetectorRef.detectChanges();\n    }\n\n    saveConfiguration(): void {\n        this.save.emit(this.configuration);\n    }\n\n    cancelConfiguration() {\n        this.cancel.emit();\n    }\n\n    customTransTitleChange(event: MultilanguageData[]): void {\n        this.customTransTitle = toMultilanguageRecord(event);\n        this.availableLanguages().forEach(({ code }) => {\n            this.configuration.customTrans![code]['title'] = this.customTransTitle[code] ?? '';\n        });\n    }\n\n    private mapTitleTrans(): void {\n        if (this.configuration?.customTrans) {\n            this.availableLanguages().forEach(({ code }) => {\n                if (!this.configuration.customTrans?.[code]) {\n                    this.configuration.customTrans![code] = {};\n                }\n                this.customTransTitle[code] = this.configuration.customTrans![code]?.['title'] ?? '';\n            });\n        }\n    }\n}\n",
      "filePath": "C:\\Users\\patrick.colom\\Repos\\SSP_Portal\\widgets\\free-content-widget\\src\\app\\containers\\settings\\settings.component.ts:40-123",
      "score": 0.28740554463577656,
      "relevanceReason": "component; presentation layer; tags: component",
      "componentType": "component",
      "layer": "presentation",
      "framework": "angular"
    },
    {
      "summary": "Angular component 'SettingsComponent' (selector: unknown) with ngOnInit, ngOnChanges.",
      "snippet": "        SWColorPickerModule,\n        MultilanguageDropdownComponent,\n        RecordToMultilanguageDataPipe\n    ]\n})\nexport class SettingsComponent implements OnInit, OnChanges {\n    private readonly changeDetectorRef = inject(ChangeDetectorRef);\n    private readonly translate = inject(TranslateService);\n    private readonly pageService = inject(PageService);\n    private readonly colorsService = inject(ColorsService);\n    private readonly ngZone = inject(NgZone);\n    @Input() availableLanguages: LanguageQuery[] = [];\n\n    readonly radioButton = viewChild(SWRadioButtonComponent);\n    customTransTextButton: { [key: string]: string } = {\n        de: '',\n        en: '',\n        fr: '',\n        it: '',\n        nl: ''\n    };\n    optionsUrl: SWRadioButtonOption[] = [];\n    readonly optionUrlsEnum = OptionUrlsEnum;\n    optionsColor: SWRadioButtonOption[] = [];\n    readonly optionColorsEnum = OptionColorsEnum;\n    readonly typeEnum: typeof LauncherTypeEnum = LauncherTypeEnum;\n    readonly typeList: string[] = Object.keys(this.typeEnum);\n    readonly iconPositions: IconPositions[] = ['LEFT', 'RIGHT', 'ABOVE', 'BELOW'];\n    readonly iconSizes: IconSizes[] = ['S', 'M', 'L', 'XL'];\n    readonly fontSizes: FontSizes[] = ['S', 'M', 'L', 'XL', '2XL', '3XL', 'H'];\n    pages: RouteInterface[] = [];\n    contrastWarning = false;\n\n    @Input() configuration: WidgetConfigInterface<LauncherCustomConfig> = {\n        customConfig: {} as LauncherCustomConfig,\n        customTrans: {}\n    } as WidgetConfigInterface<LauncherCustomConfig>;\n    @Input() language = 'en';\n\n    @Output() save: EventEmitter<WidgetConfigInterface<LauncherCustomConfig>> = new EventEmitter<\n        WidgetConfigInterface<LauncherCustomConfig>\n    >();\n    @Output() colorChange: EventEmitter<ColorConfig> = new EventEmitter<ColorConfig>();\n    @Output() cancelConfig: EventEmitter<void> = new EventEmitter<void>();\n\n    @Output() colorTypeChange: EventEmitter<string> = new EventEmitter<string>();\n\n    readonly customizationOptions = [\n        {\n            value: ColorTheme.PRIMARY,\n            viewValue: 'Primary'\n        },\n        {\n            value: ColorTheme.SECONDARY,\n            viewValue: 'Secondary'\n        }\n    ];\n\n    translationsReady = false;\n\n    ngOnInit(): void {\n        this.loadRadioButtonsOptions();\n        this.loadPages();\n        this.translationsReady = false;\n    }\n\n    ngOnChanges(changes: SimpleChanges): void {\n        if (changes['language']) {\n            this.loadRadioButtonsOptions();\n        }\n        if (changes['availableLanguages'] && this.availableLanguages?.length) {\n            this.prepareTranslations();\n        }\n    }\n\n    getEnumValue(type: string): string {\n        return this.typeEnum[type as keyof typeof this.typeEnum];\n    }\n\n    sortPagesAlphabetically(): void {\n        this.pages.sort((a, b) => {\n            if (a.path.toLowerCase() < b.path.toLowerCase()) {\n                return -1;\n            }\n            if (a.path.toLowerCase() > b.path.toLowerCase()) {\n                return 1;\n            }\n            return 0;\n        });\n    }\n\n    cancelConfiguration(): void {\n        this.cancelConfig.emit();\n    }\n\n    // This is needed otherwise the radio button change does not update the view\n    detectChanges(): void {\n        setTimeout(() => {\n            this.radioButton()?.change();\n            this.changeDetectorRef.detectChanges();\n\n... [137 more lines]",
      "filePath": "C:\\Users\\patrick.colom\\Repos\\SSP_Portal\\widgets\\launcher-widget\\src\\app\\containers\\settings\\settings.component.ts:66-302",
      "score": 0.28284439585131127,
      "relevanceReason": "component; presentation layer; tags: component",
      "componentType": "component",
      "layer": "presentation",
      "framework": "angular"
    },
    {
      "summary": "TypeScript in settings.component.spec.ts.",
      "snippet": "import { ComponentFixture, TestBed } from '@angular/core/testing';\nimport { SettingsComponent } from './settings.component';\nimport { TranslateModule, TranslateService } from '@ngx-translate/core';\nimport { CommonModule } from '@angular/common';\nimport { FormsModule } from '@angular/forms';\nimport { SWDropdownModule, SWIconModule, SWRadioButtonModule, SWTextFieldModule } from '@sw/angular-controls';\nimport { CodeBlueToggleSwitchModule } from '@codeblue/prime/toggleswitch';\nimport { PortalButtonComponent } from '@ssp/ui';\nimport { LanguageTranslations, toMultilanguageArray, WidgetConfigInterface } from '@ssp/utils';\nimport { ContainerConfiguration } from '../../interfaces/container-configuration.interface';\nimport { MultilanguageDropdownComponent } from '@codeblue/angular-multilanguage';\n\ndescribe('SettingsComponent', () => {\n    let component: SettingsComponent;\n    let fixture: ComponentFixture<SettingsComponent>;\n    let translateService: TranslateService;\n\n    beforeEach(async () => {\n        await TestBed.configureTestingModule({\n            imports: [\n                CommonModule,\n                SWDropdownModule,\n                TranslateModule.forRoot(),\n                MultilanguageDropdownComponent,\n                PortalButtonComponent,\n                SWTextFieldModule,\n                SWRadioButtonModule,\n                SWIconModule,\n                CodeBlueToggleSwitchModule,\n                FormsModule\n            ]\n        }).compileComponents();\n\n        fixture = TestBed.createComponent(SettingsComponent);\n        component = fixture.componentInstance;\n\n        translateService = fixture.debugElement.injector.get(TranslateService);\n\n        component.configuration = {\n            customConfig: {},\n            customTrans: {}\n        } as WidgetConfigInterface<ContainerConfiguration>;\n        component.availableLanguages = [\n            { code: 'en', nativeName: 'English', id: 0 },\n            { code: 'fr', nativeName: 'French', id: 1 }\n        ];\n        fixture.detectChanges();\n    });\n\n    it('should create', () => {\n        expect(component).toBeTruthy();\n    });\n\n    describe('ngOnInit', () => {\n        it('should initialize translations and map text button values', () => {\n            const spyMapTextButtonValues = jest\n                .spyOn(component as any, 'mapTitleToLocalProperty')\n                .mockImplementation(() => {});\n\n            component.ngOnInit();\n\n            expect(spyMapTextButtonValues).toHaveBeenCalled();\n        });\n    });\n\n    describe('language input setter', () => {\n        it('should set language', () => {\n            const language = 'fr';\n\n            component.language = language;\n\n            expect(component._language).toBe(language);\n        });\n    });\n\n    describe('customTransTitleChange', () => {\n        it('should update customTrans with customTransTitle values', async () => {\n            const customTrans: LanguageTranslations = {\n                en: { title: 'Old Title' },\n                fr: { title: 'Ancien Titre' }\n            };\n            component.configuration = {\n                customTrans\n            } as WidgetConfigInterface<ContainerConfiguration>;\n            component.customTransTitle = {\n                en: 'New Title',\n                fr: 'Nouveau Titre'\n            };\n\n            component.customTransTitleChange(\n                toMultilanguageArray({\n                    en: 'New Title',\n                    fr: 'Nouveau Titre'\n                })\n            );\n\n            expect(component.configuration.customTrans).toEqual({\n                en: { title: 'New Title' },\n                fr: { title: 'Nouveau Titre' }\n            });",
      "filePath": "C:\\Users\\patrick.colom\\Repos\\SSP_Portal\\widgets\\container-widget\\src\\app\\containers\\settings\\settings.component.spec.ts:1-100",
      "score": 0.19979862772728177,
      "relevanceReason": "content match"
    },
    {
      "summary": "TypeScript in settings.component.spec.ts.",
      "snippet": "import { ChangeDetectorRef, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';\nimport { ComponentFixture, TestBed } from '@angular/core/testing';\nimport { TranslateModule } from '@ngx-translate/core';\nimport { LanguageTranslations, toMultilanguageArray, WidgetConfigInterface } from '@ssp/utils';\nimport { SettingsComponent } from './settings.component';\nimport { CurrentLanguageService } from '@codeblue/angular-multilanguage';\nimport { widgetTranslations } from '../../translations/translations';\n\ndescribe('SettingsComponent', () => {\n    let component: SettingsComponent;\n    let fixture: ComponentFixture<SettingsComponent>;\n\n    beforeEach(async () => {\n        await TestBed.configureTestingModule({\n            imports: [TranslateModule.forRoot(), SettingsComponent],\n            providers: [ChangeDetectorRef, CurrentLanguageService],\n            schemas: [CUSTOM_ELEMENTS_SCHEMA]\n        }).compileComponents();\n\n        fixture = TestBed.createComponent(SettingsComponent);\n        component = fixture.componentInstance;\n        fixture.componentRef.setInput('availableLanguages', [{ code: 'en', nativeName: 'English', id: 0 }]);\n        fixture.componentRef.setInput('translations', widgetTranslations);\n        fixture.componentRef.setInput('configuration', {\n            customTrans: {},\n            customConfig: {}\n        } as WidgetConfigInterface);\n        fixture.detectChanges();\n    });\n\n    it('should create', () => {\n        expect(component).toBeTruthy();\n    });\n\n    it('should map customTransTitle on ngOnInit if configuration has custom translations', async () => {\n        const customTrans: Record<string, object> = {\n            en: { title: 'English' },\n            de: { title: 'German' },\n            fr: { title: 'French' }\n        };\n        fixture.componentRef.setInput('configuration', { customTrans, customConfig: {} } as WidgetConfigInterface);\n        fixture.componentRef.setInput('availableLanguages', [\n            { code: 'en', nativeName: 'English', id: 0 },\n            { code: 'de', nativeName: 'German', id: 1 },\n            { code: 'fr', nativeName: 'French', id: 2 },\n            { code: 'it', nativeName: 'Italian', id: 3 },\n            { code: 'nl', nativeName: 'Dutch', id: 4 }\n        ]);\n        component.ngOnInit();\n        expect(component.customTransTitle).toEqual({\n            en: 'English',\n            de: 'German',\n            fr: 'French',\n            it: '',\n            nl: ''\n        });\n    });\n\n    it('should emit selectedLanguageUpdated event on updateSelectedLanguage', () => {\n        const lang = 'en';\n        jest.spyOn(component.selectedLanguageUpdated, 'emit');\n        component.updateSelectedLanguage(lang);\n        expect(component.selectedLanguageUpdated.emit).toHaveBeenCalledWith(lang);\n    });\n\n    it('should update configuration on customTransTitleChange', () => {\n        const configuration: WidgetConfigInterface = {\n            customTrans: {\n                en: { title: '' },\n                de: { title: '' },\n                fr: { title: '' },\n                it: { title: '' },\n                nl: { title: '' }\n            } as LanguageTranslations,\n            customConfig: {}\n        } as WidgetConfigInterface;\n\n        fixture.componentRef.setInput('configuration', configuration);\n\n        component.customTransTitleChange(\n            toMultilanguageArray({\n                en: 'Title',\n                de: 'Title',\n                fr: 'Title',\n                it: 'Title',\n                nl: 'Title'\n            })\n        );\n\n        component.availableLanguages().forEach(({ code }) => {\n            expect(configuration.customTrans![code]['title']).toBe('Title');\n        });\n    });\n\n    it('should emit configuration with saveConfiguration function', () => {\n        jest.spyOn(component.save, 'emit');\n        component.saveConfiguration();\n        expect(component.save.emit).toHaveBeenCalled();\n    });\n",
      "filePath": "C:\\Users\\patrick.colom\\Repos\\SSP_Portal\\widgets\\free-content-widget\\src\\app\\containers\\settings\\settings.component.spec.ts:1-100",
      "score": 0.1994007315810546,
      "relevanceReason": "content match"
    }
  ],
  "totalResults": 5
}