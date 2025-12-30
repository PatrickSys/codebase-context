########## LINKEDIN ARTICLE FROM PERSONA 1:

Microsoft tracks 1st-try AI-generated code acceptance at 30%. GitHub Copilot users average similar numbers. Meanwhile, we consistently achieve a 70% SUCCESS RATE on enterprise projects - yes, REALLY.

It’s NOT because we have better models, but because we built something models can actually plug into.

Here are 5 things that more than 2X’d our AI code acceptance rates:

1. Centralized Context Management

Generic AI scans your repo and calls it context. But your real coding patterns , development conventions, and toolchain integrations are distributed across many systems that are air gapped from the repo, and (let's be real) poorly documented. Or worse, context resides in tribal knowledge in the heads of senior engineers.

Until you add a unified context layer that all developer prompts are routed through automatically, your AI Assistant will never know what great looks like for you.

2. Automated A/B Optimizations

Every code generation becomes a learning opportunity. We A/B test different context injections automatically under the hood. What works gets deployed to the team. What fails gets archived. 1st-try acceptance rate climbs weekly as the system discovers what works best with your unique team's standards and preferences.

3. Multi-Agent Workflow Automation

Every company's workflow is unique: Jira → Figma → Code → Tests → Docs → PR → Update ticket.

What used to take 1-2 days per component, we automate end-to-end in 3-5 minutes. Our MCP integration creates custom workflows matching YOUR process exactly. The AI doesn't just generate code, it completes the entire developer journey, from reading Jira requirements to updating tickets after merge.

That's why acceptance rates soar: the code arrives to a developer only after sub-agents have validated it to match Figma, unit tested, debugged, and documented. Ready for production.

4. Presence of a Tier 1 Developer

AI without expertise is just sophisticated autocomplete. Pair it with a senior engineer who understands edge cases, architectural implications, and business context? That's when 70% becomes achievable. They guide the AI, validate output, and ensure generated code isn't just functional, but strategically sound.

7. Ship evidence, not promises

Fortune 100 retailer project: One engineer re-delivered it in under a month using Ckye, our AI-agnostic development environment. Another scope quoted at $1.5M and 9 months: Done in 2 months for around $300k.

The model is NOT your moat.

Your system most definitely IS.

Microsoft’s 30% is where most teams plateau.

We got to 70% by building infrastructure that makes any model perform better.

One senior engineer with Ckye now replaces one senior plus 10 offshore.

The AI isn’t better.

The system around it actually works :)


---------- PERSONA 1 product: https://www.agilitee.com/ckye,

PERSONA 1 PRODUCT CLAIMS:

Context Management - Beyond the Repo
Your codebase tells only part of the story. Ckye captures the complete narrative. Context management goes beyond the repo to ingest your entire development ecosystem, including direct access to Design Systems ADRs, API specs, Internal Wikis, and Company-Specific Standards.


Built Around Your Workflows
Too many AI tools fail because they force teams to abandon a proven processes. Ckye takes the opposite approach- it automates the busy work of existing workflows rather than replacing them.


Access Control
Role-based permissions ensure rigerous adherence to development standards- even for the most complex and distributed teams.


Integrations
Modern enterprises run on dozens of specialized tools. Ckye doesn't replace them- it connects them, creating a unified intelligence layer across your development ecosystem.


Continuous Improvement
Static AI tools become obsolete the moment your team adopts a new pattern. Ckye evolves continuously, learning from every code review, every merged PR, and every architectural decision.


IDE and LLM Agnostic
Your enterprise shouldn't be locked into today's tools when tomorrow's are better. Ckye's agnostic architecture ensures you can use any IDE, any LLM, and any AI model- all while maintaining consistent, high-quality output.


Always Up to Date
In fast-moving enterprises, yesterday's patterns can be today's technical debt. Ckye maintains continuous synchronization, ensuring every developer works with the latest standards, patterns, and conventions.


MCP Native
Ckye embraces Anthropic's Model Context Protocol (MCP) as its foundational architecture, ensuring seamless integration with any MCP-compatible system while maintaining vendor independence.


Security
Cyke uses SAML SSO for authentication, ensuring only specific users in your org can update configurations. All data is encrypted in transit via TLS, and at rest via AES256.

How to Get Ckye
Ckye starts with a 30-day human assessment. We'll analyze your current codebase, development workflows, and design systems to create your proprietary Ckye implementation.

By day 31, you'll have a clear modernization blueprint and Ckye ready to accelerate your first sprint. No lengthy RFPs, no bloated consulting phases. Just rapid time-to-value.

-- PERSONA 1 LINKEDIN URL: https://www.linkedin.com/in/stevestreet/


################# P


Interesting post about Antigravity system prompt:

https://www.linkedin.com/pulse/googles-antigravity-system-prompt-johnmark-obiefuna--cyq6f/?trackingId=8O4kOyWeQs%2BMcBoTAyWayA%3D%3D


################## ARTICLE ABOUT AGENTIC CODING:

https://www.linkedin.com/pulse/from-autocomplete-autonomy-how-github-copilot-agents-reshaping-giesa-nbmfe/?trackingId=2%2BPzDp01TIWnLyNWjiSDmA%3D%3D


From Autocomplete to Autonomy: How GitHub Copilot Agents Are Reshaping Software Development
Andreas Giesa
Andreas Giesa 
Shaping Tomorrow with AI Today


5 de junio de 2025
The next generation of AI pair programming – GitHub Copilot Agents – is here, bringing autonomous, human-like assistants to software teams. These agentic AI helpers not only write code but also collaborate across tools and tasks, signaling a new era of cross-functional teamwork and a broader transformation in knowledge work.

The Rise of the AI Coding Agent
As a Digital Business Consultant at Xebia, I have a front-row seat to how rapidly AI is changing the way we work. One innovation that stands out is GitHub Copilot’s new “Agent” mode – an evolution of the AI pair programmer concept introduced in 2021. GitHub Copilot began as an AI assistant that could suggest code and help developers avoid boilerplate drudgery. Crucially, it was designed not to replace developers, but to support them as a “pair programmer,” always on their side. In the words of GitHub’s CEO, “artificial intelligence (AI) isn’t replacing the developer. Instead, it’s always on their side”. Copilot was the first officer to your pilot – helping with navigation and minor controls. Now, with Copilot Agents, that first officer has learned to take more initiative, tackling entire tasks autonomously when asked.

GitHub Copilot Agents (currently available in Visual Studio Code and soon other IDEs) elevate the platform from a smart autocomplete to an autonomous coding agent. In simple terms, a Copilot Agent can be given a high-level goal (for example, “Create a web app to track marathon training progress”) and it will plan, execute, and iterate on that task with minimal hand-holding. This is a dramatic leap from the traditional use of AI in coding. Previously, developers might use a chatbot or generative AI (like ChatGPT) to get a code snippet or answer – essentially a one-off suggestion they would copy, paste, and manually integrate. Copilot Agent mode, by contrast, acts like a junior developer empowered to handle the whole task: it reads relevant files, writes or modifies code across the codebase, compiles and runs tests, observes the results, and fixes any errors it encounters – looping this process until the task is completed. This self-iterative workflow means the AI isn’t just answering your prompt, it’s working through it step by step, much as a human would.

To illustrate, GitHub notes that in Agent mode, Copilot can “iterate on not just its own output, but the result of that output,” inferring additional subtasks needed and even catching and fixing its own mistakes. It’s capable of recognizing a runtime error in code it wrote, suggesting a fix, and applying that fix automatically. Instead of requiring the developer to manually debug or re-prompt the AI for corrections, the agent takes on the tedious trial-and-error cycles. In effect, the AI agent is starting to behave like an autonomous collaborator, not just a code-drafting tool. This shift is so significant that industry observers are dubbing it a move from “generative” AI to “agentic” AI – meaning AI that doesn’t just generate content when asked, but can execute actions and decisions towards a goal. As a McKinsey expert describes, generative AI is reactive (it responds to prompts), whereas an agentic AI “is executing on a task… perceiving reality, deciding, applying judgment, and executing something” on its own. In practical terms, your Copilot Agent is no longer just suggesting code – it’s developing features.

Classic vs. Agentic: A Paradigm Shift in AI Coding Assistance
How do GitHub Copilot Agents differ from the traditional AI coding assistance that many developers are already familiar with? The contrast can be stark. Below is a high-level comparison between classic AI coding support and the new agent-based collaboration:

Table: Traditional AI coding support vs. GitHub Copilot’s agent-based approach.
Table: Traditional AI coding support vs. GitHub Copilot’s agent-based approach.
This paradigm shift, from AI as a passive assistant to AI as an active team member, cannot be overstated. It changes the developer’s role to one of guidance, review, and high-level decision-making, while the AI agent handles much of the grind. Developers remain in control – they define the goals, review the agent’s output, and can intervene at any point – but they are boosted by an assistant who works relentlessly and tirelessly on the mundane parts of the job. GitHub emphasizes that with agent mode, you stay in the driver’s seat: every tool invocation is transparent, terminal commands require your approval, and you can undo any AI-made changes with a click. This design ensures that while the AI is autonomous in execution, the human is always the ultimate decision-maker. It’s a fine balance between letting the agent roam free to solve problems and maintaining governance over what changes are made – a balance that resonates strongly with executives concerned about software quality and security.

Contenido del artículo
Developer Evolution Timeline
Personalizing AI with Your Own Data – The Power of MCP
One of the most significant enablers of this new agentic Copilot is Model Context Protocol (MCP). Why is this important? Traditionally, one major limitation of generic AI models is that they don’t know your company’s code, APIs, or documentation. They operate on broad training data which might not reflect your specific environment, leading to irrelevant suggestions or “hallucinations” (confidently wrong outputs) when dealing with internal libraries or domain-specific code. GitHub’s solution is to let Copilot securely tap into your organization’s knowledge without retraining the core model from scratch. Copilot Agents “hook into MCP servers to draw on data from your repositories and external resources” – effectively giving the AI access to a curated knowledge base about your codebase, tools, and even third-party docs relevant to your work. Think of MCP as a bridge between the AI and your proprietary context: it can feed the AI information from, say, your private libraries, past code commits, design docs, or wiki, as needed to fulfill a task.

The result is an AI assistant that “codes like an insider”, as GitHub puts it. From day one, a Copilot Agent augmented with MCP can behave like a developer who has read your project’s README, understands your coding guidelines, and has access to the latest API documentation of the packages you use. For example, if you’re using an internal API or an updated framework, the agent can reference the correct usage patterns from your docs rather than guessing. This dramatically improves both the relevance and correctness of the AI’s output. A community-built tool called the “Docs MCP Server” demonstrates this concept by giving AI assistants up-to-date documentation access; it “provides a personal, always-current knowledge base” and indexes third-party docs so the AI won’t rely on stale training data. In practice, that means far fewer erroneous suggestions and much less time spent checking the AI’s work against documentation, because the AI is already looking at the latest docs and project notes you’ve provided.

From an executive perspective, MCP is a game changer because it allows customization and control. You can equip your AI agents with the knowledge you want them to have – whether it’s company coding standards, specific domain knowledge, or proprietary libraries – all while keeping that data private. It moves us away from one-size-fits-all AI and toward personalized AI assistants for each organization. Moreover, it does so in a way that can be governed: you decide what repositories or data sources the AI can tap into, mitigating the risk of an AI giving advice based on unknown or unauthorized content. This is particularly important in sectors like finance or healthcare, where sensitive data and compliance requirements mean an AI assistant must be constrained to a vetted knowledge sphere. With MCP and features like Copilot Spaces (which let your team organize code, docs, and notes together as contextual fodder for Copilot), GitHub is effectively offering a Model + Data combo that is unique to your business. The AI pair programmer isn’t just fluent in Python or Java – it’s fluent in YourCompany as well.

Working Side-by-Side with AI – A New Collaborative Dynamic
Another striking aspect of GitHub Copilot Agents is how they work with people and tools in a collaborative, almost human-like way. In agent mode, using Copilot starts to feel less like using a chatbot and more like delegating tasks to a competent (though junior) developer on your team. For instance, you can assign a bug or feature issue to the Copilot Agent, and it will plan out a solution, make the necessary code changes, and even open a pull request with the results. This parallels a real-world scenario where a tech lead delegates a task to a developer and expects a code change delivered for review. Copilot will even write tests for the new code where appropriate and run those tests to ensure everything passes. It’s not hard to imagine a near future where a significant chunk of routine tickets (say a simple feature request or a known type of bug fix) are handled almost end-to-end by an AI agent, with the human team only doing the final code review and approval.

Contenido del artículo
The Roles of Copilot
The human–AI interplay here is critical. GitHub describes it as having both a human and an agent in the loop. You might let the agent attempt a solution, but you can step in at any point: maybe you leave a code comment to guide Copilot in a certain direction, or you intervene if it’s going down the wrong path. This is akin to mentoring a junior dev – sometimes you let them figure things out, other times you course-correct with a comment or suggestion. The agent can even ask for help when needed. For example, Copilot might suggest a command to run the project’s test suite and then ask you to execute it (for safety reasons). In this way, the agent treats you as the senior partner who oversees risky operations, much like a real teammate would seek confirmation before running a database migration script. Far from isolating developers, this dynamic can actually enhance team collaboration: developers are freed from tedious tasks and can focus more on creative problem-solving, and they spend more time verifying and refining outcomes (which encourages knowledge sharing and discussion) rather than wrestling with syntax errors or environment setup.

Importantly, Copilot Agents also integrate with the broader software ecosystem of tools, which fosters cross-functional collaboration. Consider how the agent uses GitHub Actions to run tests and CI pipelines – this brings QA and DevOps processes into the loop of the AI’s work. An AI that can trigger a build, run test suites, and even perform code reviews (Copilot has a code review mode too, acting as an automated reviewer catching bugs) blurs the lines between traditionally siloed roles. Your QA engineers, for example, might initiate an agent to generate regression tests for a new feature, or your operations team could use an agent to automatically generate infrastructure-as-code scripts for a deployment. In early use cases at Microsoft, internal teams have developed Copilot-style agents for tasks like converting natural language requests into working SQL or KQL queries for data analysis. This means a business analyst could ask a question in plain English and get results from a database without always having to loop in a data engineer – the AI agent bridges that gap. Such scenarios hint at how cross-functional collaboration can be supercharged: each specialist can delegate certain tasks to AI agents that understand the context of the other domain. The result is faster iteration and less friction when moving from, say, requirements to code or from code to test and deployment.

On a human level, integrating AI agents in the team can actually improve communication and collaboration. It may sound counterintuitive, but when routine tasks (like writing boilerplate code or basic tests) are handled by Copilot, developers have more bandwidth to interact with product managers, designers, and testers about the important stuff – the requirements, the edge cases, the user experience. Rather than being buried in low-level bug fixes, developers can engage in higher-level discussions with colleagues, with the AI taking care of the mechanical details in the background. Additionally, the AI can serve as a knowledge intermediary. For example, if a non-developer stakeholder has a question about how a feature is implemented, the Copilot agent (with its access to code and docs) could generate an explanation or even a diagram, facilitating understanding across the team. We already see glimmers of this in tools like Microsoft 365 Copilot, where an AI can summarize a lengthy document or thread for someone from another department. In the software context, an AI agent might summarize a set of code changes for a QA lead or generate release notes for the marketing team – tasks that cross functional boundaries.

Beyond IT: A Glimpse into the Future of Work with Agentic AI
What’s happening in software development with GitHub Copilot Agents is not an isolated phenomenon – it’s a bellwether for a broader shift in knowledge work across all industries. Today it’s coding assistants that can debug themselves; tomorrow we’ll have AI agents that can plan business trips, manage customer inquiries, or handle supply chain optimizations with similar autonomy. In fact, we’re already seeing early examples: think of AI-powered agents that can plan your next overseas trip and book everything, virtual healthcare bots that act as patient companions, or AI supply-chain specialists that adjust inventory on the fly. These might sound futuristic, but they are emerging as the “coming era of agentic AI” described by Harvard Business Review. The underlying theme is the same – moving from static tools to dynamic agents that can understand goals, interact with the world (digital or physical), and carry out multi-step tasks.

In the corporate context, some visionaries predict that companies will soon have AI agents integrated as part of their workforce. A recent McKinsey podcast even imagines an org chart where alongside human employees, you have roles filled by AI agents. This isn’t science fiction; it’s already starting in controlled domains. For example, many enterprises are experimenting with agents in IT support, where a user request (like a password reset or system diagnostics) follows a defined process – perfect for an AI agent to take over. Software development, as we’ve discussed, is another ripe area given its structured workflows from issue to code to deployment. Customer service bots that go beyond scripts to truly resolve issues are on the horizon as well. The big picture is that agentic AI could become a digital team member in virtually any department: an assistant under the direct supervision of human experts, handling the grunt work at high speed and scale.

For leaders and C-level decision-makers, this is a pivotal moment. Agentic AI is poised to redefine productivity and innovation. It holds the potential for “a digital replica of the entire workforce” in terms of capability – not replacing your people, but rather replicating their routine tasks into AI counterparts so that your human talent can focus on what truly adds value. In practical terms, that could mean doubling or tripling output in certain functions without a linear increase in headcount. It also means new skills and management approaches will be needed. Just as developers are learning to mentor and supervise AI coding agents, managers will need to learn how to allocate work between human teams and AI agents, and how to govern this hybrid workforce. At Microsoft, where employees are already building and using custom Copilot-style agents internally, they talk about “agentic extensibility expanding the frontier of enterprise AI”, allowing people to reinvent workflows and personalize AI’s power like never before. But they also emphasize governance – ensuring these agents are used safely, securely, and in compliance with policies. This is a reminder that as we embrace agentic AI, we must also put frameworks in place to manage it (from data protection to ethical guidelines), much as we did with earlier waves of technology.

Contenido del artículo
Copilot Agents as a virtual team
Conclusion: Embracing the Agentic Future
GitHub Copilot Agents give us a tangible glimpse of the future of work: humans and AI agents working hand-in-hand, each doing what they do best. The early results in software development are highly encouraging – faster development cycles, fewer tedious tasks for engineers, and a new level of interaction between people and intelligent tools. But beyond the productivity boost lies something more visionary: the chance to fundamentally reimagine how work gets done. In this new paradigm, a developer can delegate routine coding to an AI, a finance analyst might delegate number-crunching to an AI, and a project manager could delegate schedule optimizations to yet another AI agent. Every knowledge worker could have an AI colleague in their corner.

For executives, the message is clear. Agentic AI is not a future curiosity – it’s arriving now, and it’s arriving in a form that can transform your business. Savvy tech leaders will see Copilot Agents as an opportunity to leap ahead: to streamline IT operations, empower their teams with AI co-workers, and break down silos between departments through shared AI assistance. It’s also an opportunity to foster innovation – freeing your talent from drudgery so they can spend more time on creative, strategic work that truly moves the needle. Adopting agentic AI in the enterprise will require vision and adaptation. It means investing in training your people to work effectively with AI agents, updating processes to integrate these new “digital team members,” and instituting governance to use them responsibly. But the payoff is a future where organizations are faster, smarter, and more collaborative than ever before.

In the end, GitHub Copilot Agents exemplify a key principle of the future of work: AI doesn’t replace humans; it augments them. Just as Copilot places the developer at the center of software creation with AI as a reliable wingman, broader agentic AI will place human expertise at the center of every domain, amplified by machines that learn, execute, and improve alongside us. The companies that embrace this shift early – thoughtfully and boldly – will lead the next wave of innovation. The era of autonomous collaborators has begun, and it’s time to welcome our new AI agents to the team. The sky is the limit for what human-AI collaboration can achieve in this agentic age of work.





Thanks to Michael Kaufmann , Emanuele Bartolesi and Harald Binkle which inspired me to this article with their key notes and talks at the Microsoft, Github event we did from Xebia in Munich.

Also credits to the great sources, where I "deep researched" the insights from:

GitHub Docs — https://docs.github.com
GitHub Blog — https://github.blog
GitHub (Copilot & MCP repos) — https://github.com
Microsoft Learn — https://learn.microsoft.com
McKinsey & Company — https://www.mckinsey.com
Harvard Business Review — https://hbr.org
Business Insider — https://www.businessinsider.com



#############################ANOTHER ARTICLE

2. Rule-Based Agent Intelligence
Agents don’t just respond to prompts — they follow engineering rules, much like a human developer would follow a style guide or quality checklist.

Examples include:

Enforcing SOLID principles in backend code
Requiring test-driven development on all frontend features
Adhering to your specific security protocols and coding standards
Applying experimental modes for agents trained to debug or explore unknowns

These rules are encoded during agent curation and fine-tuned through usage. The result is code that’s not just correct, but consistent — and often better than human-generated alternatives.

3. Documentation as Fuel, Not Overhead
Generative AI models are only as good as the documentation they’re trained on. But documentation is often scattered, outdated, or too general.

In vibe coding, we flip the model. We provide:

Focused, task-specific documentation (e.g., “how to deploy a React app to AWS with Terraform”)
Agent-specific knowledge bases based on so that its model does not get overwhelmed when doing Retrieval Augmented Generation
Small, composable snippets rather than large, unstructured wikis

Think of this as micro-documentation: tightly scoped, easily retrievable, always relevant.

For example, when working against a GraphQL backend using Apollo, your frontend agent is provided with targeted docs on both technologies. It knows where to look, what to apply, and when to escalate.

4. Contextual Awareness and Data Sensitivity
Agents must work within the context of your organization and your data boundaries. For example:

A claims-processing app for a leading insurance company requires knowledge of insurance workflows
A KYC feature for a neobank must comply with specific regulations and data handling rules

Through secured, governed access to customer-specific data, agents can write code that is more accurate, more personalized, and more compliant.

This is never done recklessly. We employ:

Fine-grained access controls
Masking of sensitive information
Read-only data ingestion where appropriate

AI-first does not mean control-last.

5. Choosing the Right LLM for the Task
Not all large language models (LLMs) are equally capable — or equally efficient. Some are good at following instructions (Claude 4), others at broad reasoning (GPT-4.1), and still others are more cost-effective at scale (e.g., Mistral, Mixtral, or Phi-3 for internal tasks).

In the vibe coding system, we map LLM capabilities to agent needs:

High-context planning? Use Claude.
Complex multi-turn reasoning? Use GPT-4.
Lightweight refactoring? Use a fast, low-cost open model.

By selecting the optimal LLM per task, we balance performance, reliability, and cost. This allows us to scale intelligently without ballooning cloud expenses.

6. Pre-Defined Prompts for Predictability
Prompts are reusable instructions that can be referenced at any time during chat. They are especially useful as context for repetitive and/or complex tasks.

We equip each agent with a library of pre-defined prompts:

How to generate boilerplate code for new services
How to write unit tests following a specific pattern
How to handle logging and error reporting

This makes outputs more predictable, easier to review, and consistent across teams — especially important when the agents interact with regulatory or mission-critical code.
##################### NEW ARTICLE PERSONA


The Land Before AI
For years, most developers followed the same routine: get a cup of coffee, open the laptop, and conduct the daily ritual of checking Jira for assigned tasks, scanning through Confluence pages for design specifications, and finally settling into the IDE to write code. This was a myth. In truth, for decades, software development followed a predictable pattern. Developers navigated between multiple tools throughout their day, each serving a specific purpose but creating an increasingly fragmented experience. The IDE remained the heart of development work, where actual coding happened, but the developer had to leave their central focus to chase things down.

Here's the reality: developers started the day in Jira, accepting a new feature request. Uncertain about the implementation approach, they could navigate to Confluence and search through dozens of pages to find relevant design patterns and team standards. Once the answer was found, developers returned to the IDE to begin coding. But the cycle didn't end there. Throughout the day, questions would arise—about API specifications, coding standards, or architectural decisions—sending developers back into the documentation maze.

This fragmentation hit new team members particularly hard. When junior developers joined a team, they faced a steep learning curve that went far beyond understanding the codebase. They needed to master the team's scattered knowledge ecosystem, learning where to find answers across multiple systems and understanding the unwritten rules that governed development practices.

The Dawn of Coding Assistants: Promise and Limitations
When GitHub, Copilot and similar tools first appeared, they felt almost magical. Developers could type a comment describing what they wanted, and code would appear as if by magic. Initially, these tools were curiosities. Developers used them for creating simple projects, generating boilerplate code, or building quick proof-of-concepts. The novelty was undeniable, but the practical applications seemed limited to straightforward, self-contained tasks. Despite their impressive capabilities, coding assistants suffered from the same fundamental issue that plagued traditional development; they lacked context.

To get meaningful results, developers had to craft elaborate prompts, essentially recreating the same knowledge-gathering process they'd always done, but now in text form. Instead of jumping between Confluence and Jira, they found themselves writing lengthy prompts that attempted to capture all the necessary context in a single request. The assistants could see local code files, but their understanding was limited to what existed in the immediate workspace. They couldn't access the company's architectural standards documented in Confluence, understand the business context captured in Jira tickets, or leverage the institutional knowledge that lived in team discussions and code reviews.

Toward Intelligent Development Ecosystems
The Intelligent Development Ecosystem at Nymbus focused on eliminating friction and unleashing developers to do what they do best, solve problems. As a small enterprise, we needed to scale our development teams. AI needed to act as a partner in development, not just a prototyping tool. Even if the AI doesn’t generate a line of code, keeping the developer in their IDE when finding knowledge was important.

We broke down three things we needed the AI to do to help us be successful beyond simple prototyping and small app developments. First, we needed AI to be able to collaborate with developers. When a developer is in their IDE, the goal is to try to keep them in the IDE and use AI to help manage tickets, look up documentation, and quickly relay requirements from product to development. To do this, Nymbus adopted a select set of MCP servers to enable collaboration.

 

Contenido del artículo
Second, Nymbus focused on context. One of the early problems we had using AI tools was understanding our coding standards or project specific frameworks. Initially, our developers attempted to accomplish everything in one, monolithic prompt. Breaking standards into markup files and aligning releases with product specifications makes it easier to version our communication with AI. This approach provides instant context across multiple levels of our software teams, helping them apply the right constraints for each project. As a result, the AI can generate code, documentation, and test cases that are more consistent, boilerplate, and readable for our teams.

Finally, we found that legacy documentation, third-party pdfs, and other unstructured data often exceeded the capacity of our MCP servers. In this case, we leverage vector databases to make unstructured data available to our Intelligent Development Ecosystem.

Practical Framework for Intelligent Development Ecosystems
The IDE is still the center of a developer’s world, and AI driven coding assistants can help bring existing tooling, standards, and documentation into the IDE quickly.

Contenido del artículo
At Nymbus, we selected Amazon Q as our primary AI engine, which leverages Claude as its underlying large language model. Claude’s features are integrated directly into our IDE, including support for using markdown to guide development. Additionally, as a heavy AWS organization, consolidating our tech stack within AWS offers clear advantages—from optimized LLM insights into our deployments to streamlined billing. Although we don’t use ChatGPT directly in our IDE, it’s good to have more than one choice of LLM to solve a problem. Claude does a great job inside the IDE, but we’re leveraging ChatGPT as a bridge between our nontechnical teams and technical teams to cover things like compliance and even HR benefits.

Nymbus leverages context files to enable our teams from a global level all the way down to the project. When a developer starts development, they can grab corporate standards from the global depot, product standards from the product repo, and project specific markdown from the project repo. This allows our teams to version standards and decisions where it matters most. When a project specification changes, it's versioned. New security standards are also versioned, allowing anyone to access and apply the latest version in their project. Organizing and governing these standards in markdown is essential for taking your AI-assisted coding to the next level.

We adopted The Figma MCP server, Jira, and Confluence to expand AI’s ability to quickly find, create, and manage tasks within our IDE. Our teams maintain a large knowledge base of tickets and documentation in Jira and Confluence, so it was important to avoid selecting tools that introduce overlapping information. This helps prevent the AI from encountering conflicting data during its processes. Additionally, our central point of documentation, Confluence, is now part of the IDE. If a developer needs to find knowledge, there isn’t a need to scan across tickets or Confluence when the AI can do it. The objective is to bring knowledge closer to the developer. MCP provide the framework for bringing knowledge from tools closer to the developer. 

Our last component is our knowledge repository that can hold unstructured data. For development, Amazon Bedrock has great integration with Amazon Q allowing us to expose code or unstructured data within the IDE. In some cases, we still have nontechnical knowledge repositories when the teams need to deal with nontechnical resources.

A Day in the Life: John's Team
John - Product Manager
John's product management team just finished meeting with a client who shared some great ideas for their next release. John works with his team to lay out the business requirements in a Product Requirements Document (PRD).

His team leverages AI to help build exit criteria and flesh out requirements, ensuring they are concise but readable. The AI helps John's team logically group requirements into coherent features, providing a solid starting point for review and refinement.

Once the review is complete, John adjusts the PRD to better align with his vision. He then asks his AI assistant to create a markdown file with epics, stories, and user tasks. After making some tweaks, John brings in his lead designer and technical lead to review both the PRD and epics. The team makes necessary adjustments to the PRD, and John reviews the markdown of epics. When everyone is satisfied, John's AI creates the tickets.

Mark - UX Designer
Mark iterates through UX designs while working with John's vision of the requirements. He uses Vercel as an AI assistant to quickly generate prototypes and iterate through designs. Finally, he generates React code and commits it to git.

Sara - Technical Lead
Sara creates a technical specification in markdown for the requirements. She pulls down a template from her git repository that outlines common project technologies along with placeholders for specification descriptions and development milestones. She spends time breaking down feature requirements into specific milestones within the markdown file. When the specification is complete, she commits it to git for versioning.

Rico - Developer
Rico opens Visual Studio Code and checks his Jira tickets by asking Amazon Q about his active assignments. Q shows new tickets based on John's team's requirements. He checks Confluence from his IDE to better understand the design architecture, noting Sara's updates based on the new requirements.

Rico grabs the specification from GitLab for the new requirements, along with the company's security specification and product-specific best practices that ensure security and coding standards. After reviewing the specification document, he tackles the first milestone, which is straightforward, by asking Amazon Q to create it.

Amazon Q examines the specification, best practices, and security guidelines to generate code. The coding standards ensure new code includes unit tests and follows PCI DSS best practices. Rico reviews the generated code, makes a few changes, and updates the spec, then commits it back to the repository.

Rico works on the second milestone himself due to its complexity and his specific implementation preferences. When finished, he asks AI to review milestone 2. The AI notices that best practices require a health check for his component and recommends adding one, asking if Rico wants Q to generate it. Rico agrees, and Amazon Q adds the health check to the code.

Rico asks Q to run unit tests and perform a security scan. His code passes both tests, so he commits the new code to the repository.

Finally, Rico asks Q to update his ticket and mark it complete. He also requests Q to add a comment to the epic noting his specification changes and tag Sara. Rico then asks Q to check his Jira tickets and begins working on the next one.

Conclusion
The journey from fragmented development workflows to intelligent development ecosystems represents more than just technological advancement; it's a fundamental reimagining of how knowledge flows through software teams. At Nymbus, we discovered that the true power of AI assisted development isn't in replacing human creativity, but in eliminating the friction that prevents developers from accessing the context they need to create effectively.

What we've learned is that AI coding assistants are only as intelligent as the context we provide them. A monolithic prompt asking an AI to "build a feature" will always produce generic results. But when that same AI has access to your architectural standards, understands your business context from Jira, and can reference your team's design patterns from Confluence, it becomes a true development partner rather than just a sophisticated autocomplete tool.

Even if your coding assistant doesn’t write a piece of code, the value it brings is knowledge in our three pillars approach, collaboration through MCP servers, structured context through versioned markdown standards, and comprehensive knowledge access through vector databases, work together to create something greater than the sum of their parts. When a developer can stay in their IDE while seamlessly accessing Jira tickets, Confluence documentation, and company standards, they're not just coding faster; they're thinking more clearly about the problems they're solving.

As our teams continue to refine their markdown standards, expand their MCP server integrations, and enrich their knowledge repositories, the intelligent development ecosystem becomes more powerful. The goal isn't to eliminate human judgment but to amplify it by ensuring that every decision is made with complete context and institutional knowledge at hand.

For organizations still operating in the "land before AI," the path forward is clear: start with context, build for collaboration, and design for the developer experience. The future of software development isn't about choosing between human creativity and artificial intelligence, it's about creating systems where both can thrive together, with AI handling the knowledge retrieval and context management that has historically fragmented the developer experience.

The IDE remains the center of the developer's world, but now it's connected to knowledge that matters to developers. Feel free to share how your teams are moving beyond basic prompting and autocompletes to make your AI driven IDEs sing.

FAQ
Q: You recommend using markdown a lot in your documentation why?

A: Markdown is a great way to communicate with each other as well as communicate to a coding agent or other agentic workflow.  I can add mermaid diagrams in my documentation that are easy to change and easy for a blind AI to understand since mermaid uses a drawing syntax to generate diagrams. Markdown is also easy to version and track changes, making it a good structure for iterating.

Q: I have to make a small change to the code. Can I just use a prompt instead of updating everything?

A: Sure, there are times when tweaking code with a prompt makes sense. However, I prefer keeping track of changes, and markdown helps with that. If you're going to make a change, why not update the markdown and tell your AI to implement the changes from there?

Q: I don't want to use AI to generate my code at all. Why use this framework for development?

A: One of the biggest time sinks for developers is finding information. AI can put Jira, Confluence, and other knowledge sources right in your IDE. Even if you don't code with AI, looking up Jira tickets and maintaining them using natural language is very convenient.

Q: I've built plenty using just prompts. Why build a specification file?

A: I use specification files to break problems into smaller chunks, version my prompts, and think through technical problems. Software engineering is part coding and part solid design. Think of building a specification as designing.

Q: I don't want AI to generate all my code—maybe just the easy stuff.

A: Perfect! I break down my specification into milestones with this in mind. If I don't want AI to generate certain code, I can choose to do that milestone myself or assign it to a developer.

Q: Do you just release AI-generated code into production?

A: Absolutely not. I always review what the AI generates—you are AI's first reviewer. Sometimes I use AI to review my code, treating it as a coding partner. From a compliance standpoint, I don't release unreviewed code to production, so why would I release AI-generated code blindly?

Q: I noticed you have different markdown files at project, product, and global levels. Why?

A: It's all about replication and consistency. Think of it like federal, state, and local laws. Global markdowns create best practices and share styles across the company. Since best practices aren't one-size-fits-all, there's a product level too. For instance, my current project uses Python, but the company widely uses Java. I still need product-specific standards with Python-level best practices, not Java-based ones.

Q: Can you have more than one specification file per project?

A: Sure. I'm still working through this myself, but I lean toward keeping a specification for each feature. This allows you to maintain history without creating a huge markdown for the whole project. As features are completed, you may have multiple specification files based on release cycles or feature versions.

########### ARTICLE ON CONTEXT ENGINEERING:


Context Engineering for Claude Code: Mastering Deep Technical Knowledge
Thomas Landgraf
Thomas Landgraf
Industrial-Grade Architecture | Research-Lab Curiosity


20 de julio de 2025
From Hallucinations to High Fidelity: The Power of Purpose-Built Knowledge

After spending considerable time with Claude Code, I've come to a crucial realization: success with AI coding assistants is fundamentally about context engineering. It's not just about asking the right questions—it's about providing the right knowledge foundation.

The Three Pillars of Context Engineering
In my projects, I've identified three essential components for effective AI-assisted development:

a) Project Architecture Knowledge Understanding of class hierarchies, libraries, frameworks, and design patterns specific to your codebase. Mostly stored in the CLAUDE files.

b) Product Requirements Documentation Clear specifications of what the product should do, gathered through user stories, requirement engineering, and customer interviews. Stored in *.prd.md files in the components directories.

c) Deep Technical Knowledge Specialized understanding of core technologies, mathematical concepts, algorithms, and critical middleware components.

Today, I want to focus on that third pillar—and share a game-changing approach I've discovered for engineering this crucial part of the context.

1. The Research Revolution: Creating Knowledge Files That Transform AI Performance
Modern LLMs like GPT-4 and Claude have impressive general knowledge, but they hit walls when dealing with specialized technologies, recent updates, or complex technical implementations. This is where research tools come in.

I've developed a workflow using OpenAI's "Deep Research" and Anthropic's "Research" functionality to create comprehensive knowledge documents that dramatically improve AI coding assistance. These aren't just summaries—they're carefully crafted technical references that capture nuanced details LLMs typically miss or hallucinate about.

The impact? Tasks that previously resulted in confused implementations now produce production-ready code. The difference is like giving your AI assistant a PhD in your specific technology stack.

2. Real-World Example: Mastering Eclipse Ditto
Let me walk you through a concrete example that transformed my development workflow. We rely heavily on Eclipse Ditto, an elegant open-source digital twin solution. While GPT-4 and Claude know the basics, our implementation pushed into advanced territory where AI assistants started to struggle:

Complex Ditto policies for fine-grained access control
Web of Things (WoT) Thing Models for standardized device descriptions
Extensive RQL (Resource Query Language) for sophisticated data queries

When I asked standard coding questions about these features, the AI assistants would confidently provide solutions—that were subtly wrong. The hallucinations were particularly dangerous because they seemed plausible. Functions that didn't exist, syntax that looked right but wasn't, architectural patterns that would work in theory but fail in production.

My Solution: The Research-Driven Knowledge Document
Here's the workflow that changed everything:

Step 1: Initial Deep Research with OpenAI I prompted: "Research Eclipse Ditto's advanced features including policy management, WoT Thing Models integration, and RQL query syntax. Focus on implementation details, best practices, and common pitfalls."

Result: A comprehensive analysis with code examples, architectural diagrams, and gotchas I'd never have discovered on my own.

Step 2: Refinement with Claude Research I fed the OpenAI output to Claude with: "Based on this initial research document, validate the technical details, find any gaps, and add practical implementation examples for Eclipse Ditto policies, WoT models, and RQL queries. Focus on production-ready patterns."

Result: Claude identified three outdated patterns, added five real-world examples, and integrated insights from recent GitHub issues.

Step 3: Creating the Master Context The combined document became ditto-advanced-knowledge.md in my project. Now, whenever I work on Ditto features, this context transforms my AI assistant from a confused junior developer into a knowledgeable architect. In Claude Code, priming the context is beautifully simple: just prompt: Read @ditto-advanced-knowledge.md and understand.

The payoff? Features that previously took days of trial-and-error now ship in hours. The AI suggests optimizations I wouldn't have thought of. Most importantly, it understands our specific use case rather than giving generic advice.

Critical Best Practices I've Learned
1. Always Review Your Knowledge Files
Hallucinations in knowledge documents are catastrophic—they compound with every use. After generating any knowledge file, I thoroughly review and tweak it myself and, even better, have our domain expert validate it. One incorrect API pattern in your knowledge file means every future implementation will be wrong.

2. Manage Context Wisely
When knowledge files grow beyond 50KB (~12k token), you risk exhausting context tokens before actual coding begins. My solution: split them strategically:

ditto-advanced-knowledge-policies.md (access control patterns)
ditto-advanced-knowledge-wot.md (Thing Model implementations)
ditto-advanced-knowledge-rql.md (query language reference)

This way, I only load what's relevant. After all, I rarely need WoT models when crafting RQL queries.

3. Monitor Your Token Usage
Before importing knowledge files, I often run /compact or even /clear to maximize available context. Watch for Claude Code's "Compacting context" message—it's actively discarding your carefully curated knowledge. When this happens, reload the knowledge file.

4. Evolve Your Knowledge Files with Real Implementations
After weeks of development, I've discovered a powerful pattern: enriching knowledge files with references to working code. For example, in my Ditto knowledge file, I'll add:

For production-ready policy implementation, see @src/policies/DeviceAccessPolicy.cpp
For complex RQL query patterns, see @src/queries/TimeSeriesAggregation.cpp
Claude Code can follow these references to examine actual working examples from your codebase. This creates a powerful feedback loop—your knowledge files become living documents that grow smarter with every successful implementation. The trade-off? These enhanced knowledge files become project-specific. While the base technical knowledge remains transferable, the code references tie them to your particular codebase. I maintain two versions: a "pure" knowledge file for sharing across projects and an "enhanced" version with implementation references for maximum effectiveness within each project.

These practices transform knowledge files from static documents into dynamic tools that evolve with your project.

3. Why Can't Claude Code Research On-Demand?
You might wonder: "Why not let Claude Code do the research when problems arise?" The answer comes down to one word: tokens.

Research algorithms are token-intensive operations. Consider what happens during a single research session:

Queries to hundreds of current articles and documentation pages
Processing massive amounts of text to extract relevant information
Multiple refinement passes to synthesize findings
Generation of comprehensive, citation-backed outputs

A typical research session consumes 100,000+ tokens and costs $40-70. When you're in the flow of development, you can't afford to wait 5-30 minutes and burn through your token budget every time you hit a knowledge gap.

By front-loading this research into reusable knowledge documents, you get the best of both worlds: deep, accurate technical knowledge available instantly at a fraction of the cost. It's the difference between having a technical expert on speed dial versus sending them on a research expedition every time you have a question.

4. Under the Hood: How Research Tools Work
4.1 OpenAI Deep Research
OpenAI's Deep Research, launched in February 2025 [1], represents a breakthrough in AI-powered autonomous research. It transforms how we gather technical knowledge, moving from simple searches to comprehensive investigations that rival human researchers.

The O3 Model Foundation Deep Research runs on a specialized o3 model variant with approximately 200 billion parameters. This architecture introduces capabilities that fundamentally change what's possible:

Simulated reasoning: The model actually "thinks" before responding, pausing to reflect on its analysis
Test-time compute scaling: Allocates more computational resources for harder problems—like a human taking more time on complex questions
Extended context: Processes up to 200,000 tokens (roughly 150,000 words), enabling analysis of entire codebases or documentation sets

The results speak for themselves: Deep Research achieves 26.6% accuracy on the "Humanity's Last Exam" benchmark—a test so difficult that previous AI systems topped out at 9% [1].

Sequential Multi-Agent Pipeline Deep Research orchestrates six specialized agents in a carefully designed sequence [2]:

Triage Agent: Analyzes query complexity and routes appropriately
Clarification Agent: Refines ambiguous requests
Instruction Builder: Creates detailed research plans
Research Agent (o3-deep-research): Executes the investigation
Web Grounding Agent: Interfaces with Bing Search and renders JavaScript-heavy sites
Report Generation Engine: Produces 25-36 page reports with 100+ citations

The Infrastructure Reality Here's what makes this impractical for real-time use: Each Deep Research session requires:

Minimum 8 A100 GPUs ($24/hour for the cluster)
7-30 minutes processing time (sometimes days for complex queries)
$40-70 in token costs per comprehensive research session
Energy consumption up to 40 watt-hours per query

This computational intensity—running 1000x slower than standard ChatGPT—is precisely why pre-computing knowledge documents isn't just smart, it's essential [10].

4.2 Claude Research (Anthropic)
Claude Research takes a radically different approach—prioritizing speed and integration over exhaustive depth. Launched in November 2024, it shows how parallel processing and smart tool integration can transform research efficiency [5].

Parallel Orchestrator-Worker Architecture While OpenAI processes sequentially, Claude Research unleashes parallel power:

Claude Opus 4 as LeadResearcher: Analyzes queries using military-inspired OODA loops (Observe, Orient, Decide, Act)
Dynamic scaling: Spawns 1-20+ Claude Sonnet 4 sub-agents based on complexity
Parallel execution: Each agent works independently in its own 200K token context
90.2% performance improvement over single-agent systems in internal evaluations [4]

This architecture is why Claude can deliver results in 2-5 minutes while competitors take 7-30 minutes.

Lightning-Fast Search Integration Claude's Brave Search integration achieves remarkable efficiency:

0.56 second latency for search queries
Smart query progression: starts broad (<5 words), then narrows based on results
86.7% of final citations come from initial search results
Automatic re-searching when confidence drops below 95%
BM25 + semantic embeddings for superior ranking

The Model Context Protocol Revolution MCP is Claude's secret weapon—what Anthropic calls a "USB-C port for AI applications" [6]. This enables seamless connections to:

Enterprise tools: Jira, Confluence, Asana, Linear
Google Workspace: Search across Drive, Gmail, Calendar while researching
7,000+ apps via Zapier: Access virtually any business tool
Internal databases: Connect to proprietary knowledge bases with OAuth 2.0

Imagine researching a technical topic while simultaneously pulling from your team's documentation, checking recent Slack discussions, and reviewing Jira tickets—all in one integrated flow.

Citation Excellence Claude's dedicated CitationAgent achieves something remarkable:

Reduces source hallucinations from 10% to effectively 0%
Maps citations with surgical precision (page numbers, character indices, content blocks)
15% improvement in recall accuracy over custom implementations
Filters out SEO spam in favor of authoritative sources

The trade-off? While incredibly fast and well-integrated, Claude produces 7-page overviews rather than Deep Research's 25-36 page comprehensive reports. For context engineering, this makes Claude ideal for rapid validation and refinement rather than initial deep dives.

4.3 Comparison: Complementary Strengths for Different Phases
The fundamental trade-off is crystal clear: Claude Research delivers results 10x faster (2-5 minutes vs 7-30 minutes) but Deep Research produces reports 5x more comprehensive (25-36 pages vs 7 pages) [7]. This isn't a flaw—it's a feature that shapes how we should use each tool.

AspectOpenAI Deep ResearchClaude ResearchArchitectureSequential pipeline (6 specialized agents)Parallel orchestrator-worker (1-20+ agents)Speed7-30 minutes (sometimes days)2-5 minutes consistentlyOutput Depth25-36 pages, 100+ sources7 pages, 20-25 sourcesToken Cost~100,000 tokens ($40-70/session)~15x standard conversationContext Window200K tokens total200K tokens per agentIntegrationAzure AI Foundry, API-focusedMCP: 10+ native tools, 7000+ via ZapierCitation QualityCharacter-level precision tracking10% → 0% source hallucination rateInfrastructure8 A100 GPUs minimumMore efficient distributed processing

Strategic Usage for Context Engineering:

Phase 1: Initial Deep Dive (Use Deep Research) When exploring new technical domains like Eclipse Ditto, you need comprehensive understanding. Deep Research's thoroughness helps you:

Discover edge cases and implementation pitfalls
Understand the complete API surface
Identify best practices from across the web
Build foundational knowledge documents

Phase 2: Rapid Refinement (Use Claude Research) Once you have base knowledge, Claude Research excels at:

Validating specific implementation details
Gathering fresh perspectives quickly
Integrating insights from your existing docs (via MCP)
Updating knowledge as APIs evolve

Phase 3: Synthesis Combine outputs from both tools:

Deep Research provides the comprehensive foundation
Claude Research adds current details and validates assumptions
Result: Production-ready knowledge documents that transform AI coding performance

As industry experts note: "Many sophisticated organizations will likely use both, leveraging their complementary strengths" [7]. This isn't about choosing sides—it's about using the right tool at the right time to build the best possible context for your AI coding assistant.

Conclusion: The Future is Context-Aware AI Development
We're witnessing a fundamental shift in how AI assists software development. The era of hoping ChatGPT "knows" your obscure middleware is ending. The future belongs to developers who master context engineering.

By investing time upfront to create comprehensive knowledge documents, we transform AI coding assistants from occasionally helpful tools into consistently reliable development partners. The combination of OpenAI Deep Research's exhaustive analysis and Claude Research's rapid refinement creates a powerful workflow that captures both depth and currency.

Consider the impact: Instead of watching your AI assistant hallucinate about Eclipse Ditto policies, it now writes production-ready implementations. Rather than generic boilerplate, it produces code that reflects your specific architectural patterns and constraints. This isn't incremental improvement—it's a step change in capability.

The token economics make this approach not just sensible but inevitable. At $40-70 per Deep Research session and 15x token consumption for Claude Research, real-time knowledge gathering during development is economically unfeasible. Pre-computed, carefully curated knowledge documents are the only sustainable path forward.

As these research tools continue evolving—with OpenAI adding visual browsing and Claude expanding its MCP ecosystem—the potential only grows. Imagine knowledge documents that automatically update as your dependencies change, or context that seamlessly integrates your entire development ecosystem.

The developers who thrive in the AI-assisted future won't be those who write the best prompts. They'll be those who build the best contexts.

Have you experimented with similar approaches? What challenges have you faced in providing technical context to AI coding assistants? I'd love to hear about your experiences and exchange ideas on pushing these tools even further.

References
[1] OpenAI. "Introducing deep research." OpenAI Blog, February 2025.

[2] DataCamp. "OpenAI's Deep Research: A Guide With Practical Examples." 2025.

[3] OpenAI Cookbook. "Introduction to deep research in the OpenAI API." 2025.

[4] Anthropic. "How we built our multi-agent research system." June 2025.

[5] Anthropic. "Claude takes research to new places." November 2024.

[6] Anthropic. "Introducing the Model Context Protocol." November 2024.

[7] Bright Inventions. "Deep Research AI Tools: ChatGPT vs Claude vs Gemini vs Grok vs Perplexity." 2025.

[8] Nature. "OpenAI's 'deep research' tool: is it useful for scientists?" 2025.

[9] Lisa Peyton. "Claude's Deep Research Tool Just Blew the Competition Away." 2025.

[10] TechCrunch. "OpenAI unveils a new ChatGPT agent for 'deep research'." February 2025.