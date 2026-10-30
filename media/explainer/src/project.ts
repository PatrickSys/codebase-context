import {makeProject} from '@motion-canvas/core';

import explainer from './scenes/explainer?scene';

// Motion Canvas 3.17.2 is MIT.
// Remotion was not added. Its published terms allow a free license for an
// individual or a team of up to three people, and that license is proprietary.
// MIT keeps rendering this scene available to anyone who clones the repository.
export default makeProject({
  experimentalFeatures: true,
  scenes: [explainer],
});
