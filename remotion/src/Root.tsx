import {Composition, getStaticFiles} from 'remotion';
import {BarChartRace} from './BarChartRace';

// Both data and config are bundled at compile time so the composition's
// `durationInFrames` matches the actual dataset.
import snapshots from '../public/snapshots.json';
import config from '../../config.json';

const FPS: number = config.fps;
const FRAMES_PER_MONTH: number = config.framesPerMonth;
const HOLD_START_SEC: number =
  (config as {holdStartSec?: number}).holdStartSec ?? 0;
const HOLD_END_SEC: number = config.holdEndSec;
const WIDTH = 1920;
const HEIGHT = 1080;

const monthsCount = (snapshots as {months: string[]}).months.length;
const durationInFrames =
  (monthsCount - 1) * FRAMES_PER_MONTH +
  Math.round((HOLD_START_SEC + HOLD_END_SEC) * FPS);

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="BarChartRace"
        component={BarChartRace}
        durationInFrames={durationInFrames}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{framesPerMonth: FRAMES_PER_MONTH}}
      />
    </>
  );
};

// Suppress an unused-import warning when not in studio
export const _files = getStaticFiles;
