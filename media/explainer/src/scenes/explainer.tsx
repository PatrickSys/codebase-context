import {Layout, Rect, Txt, makeScene2D} from '@motion-canvas/2d';
import {createRef, waitFor} from '@motion-canvas/core';

const ink = '#f4f1ea';
const muted = '#c5ced8';
const card = '#1e252f';
const accent = '#e7b15a';
const font = 'sans-serif';

export default makeScene2D(function* (view) {
  view.fill('#14181f');

  const problem = createRef<Layout>();
  const product = createRef<Layout>();
  const install = createRef<Layout>();
  const close = createRef<Layout>();

  view.add(
    <Layout
      ref={problem}
      layout
      direction="column"
      alignItems="center"
      gap={22}
      width={1500}
      opacity={0}
    >
      <Txt fill={accent} fontFamily={font} fontSize={28} text="The problem" />
      <Txt
        fill={ink}
        fontFamily={font}
        fontSize={54}
        textAlign="center"
        textWrap
        width={1400}
        text="An edit can miss the patterns this repository already uses."
      />
      <Txt
        fill={muted}
        fontFamily={font}
        fontSize={30}
        textAlign="center"
        textWrap
        width={1320}
        text="Codebase Context gives coding agents a map of your repository through MCP, for developers who want their agent to find relevant code and follow the team's patterns."
      />
    </Layout>
  );

  view.add(
    <Layout
      ref={product}
      layout
      direction="column"
      alignItems="center"
      gap={28}
      width={1680}
      opacity={0}
    >
      <Txt fill={accent} fontFamily={font} fontSize={28} text="What it does" />
      <Layout layout direction="row" gap={24} width={1680} justifyContent="center">
        <Rect layout direction="column" gap={12} padding={28} width={520} height={280} fill={card} radius={16}>
          <Txt fill={accent} fontFamily={font} fontSize={28} text="Index locally" />
          <Txt
            fill={ink}
            fontFamily={font}
            fontSize={24}
            textWrap
            width={460}
            text="scans the project, builds a keyword index, and creates local semantic embeddings."
          />
        </Rect>
        <Rect layout direction="column" gap={12} padding={28} width={520} height={280} fill={card} radius={16}>
          <Txt fill={accent} fontFamily={font} fontSize={28} text="get_team_patterns" />
          <Txt
            fill={ink}
            fontFamily={font}
            fontSize={24}
            textWrap
            width={460}
            text="shows the approaches used in the repository and points to representative files."
          />
        </Rect>
        <Rect layout direction="column" gap={12} padding={28} width={520} height={280} fill={card} radius={16}>
          <Txt fill={accent} fontFamily={font} fontSize={28} text="search_codebase" />
          <Txt
            fill={ink}
            fontFamily={font}
            fontSize={24}
            textWrap
            width={460}
            text="ranks files and symbols for the task instead of returning an unstructured dump."
          />
        </Rect>
      </Layout>
      <Txt
        fill={muted}
        fontFamily={font}
        fontSize={26}
        textAlign="center"
        textWrap
        width={1500}
        text="The search result shows ranked files, relevant project patterns, and what the agent should read before it changes code."
      />
    </Layout>
  );

  view.add(
    <Layout
      ref={install}
      layout
      direction="column"
      alignItems="center"
      gap={16}
      width={1600}
      opacity={0}
    >
      <Txt fill={accent} fontFamily={font} fontSize={28} text="Install" />
      <Txt fill={ink} fontFamily={font} fontSize={36} text="Node.js 22 or newer." />
      <Rect layout padding={28} fill={card} radius={12} width={1500}>
        <Txt
          fill={ink}
          fontFamily="monospace"
          fontSize={28}
          textWrap
          width={1440}
          text="claude mcp add --scope user --transport stdio codebase-context -- npx -y codebase-context"
        />
      </Rect>
      <Txt
        fill={muted}
        fontFamily={font}
        fontSize={26}
        textAlign="center"
        textWrap
        width={1400}
        text="Claude Code line from the README. Codex, OpenCode, and the other clients have their own setup lines."
      />
    </Layout>
  );

  view.add(
    <Layout
      ref={close}
      layout
      direction="column"
      alignItems="center"
      gap={16}
      width={1560}
      opacity={0}
    >
      <Txt
        fill={ink}
        fontFamily={font}
        fontSize={36}
        textAlign="center"
        textWrap
        width={1460}
        text="Search, examples and project memory run locally by default."
      />
      <Txt
        fill={ink}
        fontFamily={font}
        fontSize={30}
        textAlign="center"
        textWrap
        width={1460}
        text="Code and indexes stay on the machine with the default local embedding provider."
      />
      <Txt
        fill={muted}
        fontFamily={font}
        fontSize={26}
        textAlign="center"
        textWrap
        width={1460}
        text="Docker, a GPU, and an API key are not required."
      />
      <Txt
        fill={muted}
        fontFamily={font}
        fontSize={24}
        textAlign="center"
        textWrap
        width={1460}
        text="The existing benchmark reports 25.7% expected-file recovery versus jCodeMunch's 27.1% in a fixed retrieval comparison; it does not establish a winner or coding quality."
      />
    </Layout>
  );

  // 0.5+5.9+0.4 + 0.5+12.7+0.4 + 0.5+8.5+0.4 + 0.5+6.7 = 37.0 seconds.
  yield* problem().opacity(1, 0.5);
  yield* waitFor(5.9);
  yield* problem().opacity(0, 0.4);

  yield* product().opacity(1, 0.5);
  yield* waitFor(12.7);
  yield* product().opacity(0, 0.4);

  yield* install().opacity(1, 0.5);
  yield* waitFor(8.5);
  yield* install().opacity(0, 0.4);

  yield* close().opacity(1, 0.5);
  yield* waitFor(6.7);
});
