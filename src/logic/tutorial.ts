// cTutorialManager / cGameManager::startTutorial (01 §5). The step counter is user+696 (CURRENT_TUTORIAL):
// 0..26 while the tutorial runs, -1 once it is done. Each step shows Tutorial_Desc_<step+1> and waits for one action.

export type TutAction =
  | 'next'           // close the narrator box
  | 'placeHouse'     // tap the flashing square: a Residence1 is placed
  | 'openSite'       // tap the construction site
  | 'rushBuild'      // RUSH the construction
  | 'openAC'         // tap the Arrival Center
  | 'rushArrival'    // RUSH the clone arrival
  | 'tapPortrait'    // tap the clone's portrait
  | 'spliceMe'       // SPLICE ME (cCharacterPopup compares step 9)
  | 'pickMayor'      // choose the MAYOR gene (cSplicerPopup compares 11)
  | 'pickMechanic'   // choose the MECHANIC gene (compares 12)
  | 'startSplice'    // tap the pink liquid
  | 'card'           // the discovery card shows up (cCardPopup compares 14)
  | 'closeCard'      // close the discovery card
  | 'placeWorkplace' // beam down the new building (cBuildTerrain compares 16)
  | 'assign'         // UTOPIUM MINE button (cCharacterPopup compares 20)
  | 'tapMine';       // tap the mine to start working (updateWorkplaceTimers compares 22)

export interface TutStep { text: string; action: TutAction; hand?: boolean }

/**
 * Steps 0..23 are the 24 cases of startTutorial; 24 and 25 are Tutorial_Desc_25/26, chained after Desc_24.
 * The hand (tutorialHand) shows on steps 3, 4, 18, 19 and 23.
 */
export const TUTORIAL: TutStep[] = [
  { text: 'Tutorial_Desc_1', action: 'next' },
  { text: 'Tutorial_Desc_2', action: 'placeHouse' },
  { text: 'Tutorial_Desc_3', action: 'openSite' },
  { text: 'Tutorial_Desc_4', action: 'rushBuild', hand: true },
  { text: 'Tutorial_Desc_5', action: 'next', hand: true },
  { text: 'Tutorial_Desc_6', action: 'openAC' },
  { text: 'Tutorial_Desc_7', action: 'next' },
  { text: 'Tutorial_Desc_8', action: 'rushArrival' },
  { text: 'Tutorial_Desc_9', action: 'tapPortrait' },
  { text: 'Tutorial_Desc_10', action: 'spliceMe' },
  { text: 'Tutorial_Desc_11', action: 'next' },
  { text: 'Tutorial_Desc_12', action: 'pickMayor' },
  { text: 'Tutorial_Desc_13', action: 'pickMechanic' },
  { text: 'Tutorial_Desc_14', action: 'startSplice' },
  { text: 'Tutorial_Desc_15', action: 'card' },
  { text: 'Tutorial_Desc_16', action: 'closeCard' },
  { text: 'Tutorial_Desc_17', action: 'placeWorkplace' },
  { text: 'Tutorial_Desc_18', action: 'rushBuild' },
  { text: 'Tutorial_Desc_19', action: 'openAC', hand: true },
  { text: 'Tutorial_Desc_20', action: 'tapPortrait', hand: true },
  { text: 'Tutorial_Desc_21', action: 'assign' },
  { text: 'Tutorial_Desc_22', action: 'next' },
  { text: 'Tutorial_Desc_23', action: 'tapMine' },
  { text: 'Tutorial_Desc_24', action: 'next', hand: true },
  { text: 'Tutorial_Desc_25', action: 'next' },
  { text: 'Tutorial_Desc_26', action: 'next' },
];

/** checkTutorial: active while the step is below 27. */
export const TUTORIAL_END = 27;

/** Utopium is set back to this when the tutorial ends ("UTOPIUM WILL RESET AFTER TUTORIAL"). */
export const TUTORIAL_UTOPIUM = 25;
