// One bundle for all plugin windows; each HTML entry declares its role on body[data-page].
import { startBorder } from '../src/ui/border.ts';
import { startCountdown } from '../src/ui/countdown.ts';
import { startHub } from '../src/ui/hub.ts';
import { startHud } from '../src/ui/hud.ts';
import { startOverlay } from '../src/ui/overlay.ts';
import { startPin } from '../src/ui/pin.ts';
import { startReview } from '../src/ui/review.ts';
import { startSettings } from '../src/ui/settings.ts';

switch (document.body.dataset.page) {
  case 'hub': void startHub(); break;
  case 'settings': void startSettings(); break;
  case 'hud': void startHud(); break;
  case 'border': void startBorder(); break;
  case 'countdown': void startCountdown(); break;
  case 'pin': void startPin(); break;
  case 'review': void startReview(); break;
  default: void startOverlay(); break;
}
