/** Transparent vector poses, matched to every exercise in the training programme. */
export type Point = readonly [number, number];
export interface Pose {
  head: Point; shoulder: Point; hip: Point; elbow: Point; hand: Point; knee: Point; foot: Point;
  farElbow: Point; farHand: Point; farKnee: Point; farFoot: Point;
}
export interface ExerciseArtwork {
  start: Pose; end: Pose;
  equipment: 'barbell' | 'dumbbells' | 'landmine' | 'roller' | 'pullup' | 'bars' | 'none';
  bench?: 'flat' | 'incline' | 'seat' | 'preacher';
  loadAtHip?: boolean;
}
function pose(head: Point, shoulder: Point, hip: Point, elbow: Point, hand: Point, knee: Point, foot: Point,
  farHand?: Point, farElbow?: Point, farKnee?: Point, farFoot?: Point): Pose {
  const offset = (p: Point): Point => [p[0] + 9, p[1] + 2];
  return { head, shoulder, hip, elbow, hand, knee, foot,
    farElbow: farElbow ?? offset(elbow), farHand: farHand ?? offset(hand),
    farKnee: farKnee ?? offset(knee), farFoot: farFoot ?? offset(foot) };
}
const stand = pose([80, 22], [80, 39], [80, 78], [60, 62], [58, 90], [83, 97], [74, 113]);
const lying = pose([28, 62], [45, 75], [85, 78], [59, 59], [54, 39], [108, 91], [117, 113]);
const bent = pose([51, 43], [66, 58], [103, 77], [61, 77], [55, 99], [100, 97], [113, 113]);

export const EXERCISE_ARTWORK: Record<string, ExerciseArtwork> = {
  'bench-press': { equipment: 'barbell', bench: 'flat', start: lying,
    end: pose([28,62],[45,75],[85,78],[54,45],[55,21],[108,91],[117,113]) },
  'incline-db': { equipment: 'dumbbells', bench: 'incline',
    start: pose([45,43],[56,60],[89,82],[68,59],[61,40],[111,91],[119,113]),
    end: pose([45,43],[56,60],[89,82],[70,38],[74,15],[111,91],[119,113]) },
  'landmine-chest': { equipment: 'landmine',
    start: pose([89,23],[88,40],[79,79],[75,59],[64,53],[77,96],[79,113]),
    end: pose([89,23],[88,40],[79,79],[72,40],[62,29],[77,96],[79,113]) },
  'barbell-curls': { equipment: 'barbell', start: stand,
    end: pose([80,22],[80,39],[80,78],[60,62],[58,39],[83,97],[74,113]) },
  'preacher-curls': { equipment: 'barbell', bench: 'preacher',
    start: pose([68,29],[72,46],[68,85],[92,60],[110,80],[91,91],[100,113]),
    end: pose([68,29],[72,46],[68,85],[92,60],[89,36],[91,91],[100,113]) },
  'leg-raises': { equipment: 'none',
    start: pose([26,88],[43,99],[88,101],[54,96],[64,106],[115,101],[143,106]),
    end: pose([26,88],[43,99],[88,101],[54,96],[64,106],[107,70],[114,33]) },
  'ab-roller': { equipment: 'roller',
    start: pose([55,46],[65,63],[97,75],[55,81],[43,98],[103,99],[87,111]),
    end: pose([43,66],[60,83],[93,87],[43,92],[28,102],[102,99],[87,111]) },
  'back-squats': { equipment: 'barbell',
    start: pose([80,22],[80,39],[80,78],[59,51],[61,35],[83,97],[74,113]),
    end: pose([69,46],[74,63],[102,85],[54,75],[55,60],[72,91],[74,113]) },
  'landmine-lunges': { equipment: 'landmine',
    start: pose([80,22],[80,39],[80,78],[70,60],[61,55],[69,96],[62,113],undefined,undefined,[108,95],[121,113]),
    end: pose([74,43],[77,60],[91,83],[67,74],[58,73],[62,86],[58,113],undefined,undefined,[116,105],[134,113]) },
  'bulgarian-split': { equipment: 'dumbbells', bench: 'seat',
    start: pose([72,23],[72,40],[74,77],[58,63],[59,85],[59,96],[55,113],undefined,undefined,[105,81],[129,79]),
    end: pose([72,40],[72,57],[85,91],[58,80],[58,98],[55,91],[55,113],undefined,undefined,[109,100],[129,79]) },
  'hip-thrusts': { equipment: 'barbell', bench: 'flat', loadAtHip: true,
    start: pose([31,57],[46,72],[85,95],[57,81],[83,88],[115,80],[115,113]),
    end: pose([31,57],[46,72],[85,74],[57,75],[83,69],[115,80],[115,113]) },
  'military-press': { equipment: 'barbell',
    start: pose([80,25],[80,42],[80,80],[54,61],[55,38],[83,98],[74,113]),
    end: pose([80,25],[80,42],[80,80],[61,28],[65,13],[83,98],[74,113]) },
  'landmine-press': { equipment: 'landmine',
    start: pose([87,24],[87,41],[79,80],[70,59],[66,44],[78,98],[77,113]),
    end: pose([87,24],[87,41],[79,80],[82,29],[87,14],[78,98],[77,113]) },
  'lateral-raises': { equipment: 'dumbbells',
    start: pose([80,21],[80,38],[80,80],[58,61],[54,89],[83,98],[74,113],[108,89],[104,61]),
    end: pose([80,21],[80,38],[80,80],[47,39],[23,35],[83,98],[74,113],[137,35],[113,39]) },
  'skull-crushers': { equipment: 'dumbbells', bench: 'flat',
    start: pose([28,62],[45,75],[85,78],[61,41],[36,35],[108,91],[117,113]),
    end: pose([28,62],[45,75],[85,78],[61,41],[67,16],[108,91],[117,113]) },
  'dips': { equipment: 'bars',
    start: pose([79,27],[79,44],[79,79],[100,52],[114,56],[106,94],[119,84]),
    end: pose([79,43],[79,60],[79,93],[101,78],[114,56],[104,107],[122,96]) },
  'oblique-twists': { equipment: 'none',
    start: pose([71,39],[74,57],[83,95],[60,65],[43,69],[117,87],[141,105],[49,64],[63,58]),
    end: pose([89,39],[91,57],[83,95],[106,63],[123,69],[117,87],[141,105],[116,65],[100,59]) },
  'plank': { equipment: 'none',
    start: pose([26,53],[46,69],[92,77],[45,93],[27,102],[118,88],[145,101]),
    end: pose([26,52],[46,68],[92,77],[45,93],[27,102],[118,88],[145,101]) },
  'deadlifts': { equipment: 'barbell',
    start: pose([56,44],[68,59],[102,79],[65,81],[61,103],[92,98],[109,113]),
    end: pose([91,22],[91,39],[87,79],[87,56],[86,76],[97,98],[109,113]) },
  'pull-ups': { equipment: 'pullup',
    start: pose([80,43],[80,61],[80,95],[47,46],[54,16],[99,106],[115,98],[107,16],[113,46]),
    end: pose([80,22],[80,39],[80,75],[56,27],[54,16],[96,97],[114,90],[107,16],[105,27]) },
  'landmine-rows': { equipment: 'landmine', start: bent,
    end: pose([51,43],[66,58],[103,77],[84,57],[85,68],[100,97],[113,113]) },
  'db-rows': { equipment: 'dumbbells', bench: 'flat',
    start: pose([47,41],[61,56],[103,77],[59,77],[54,98],[110,80],[128,108],[42,79],[51,69]),
    end: pose([47,41],[61,56],[103,77],[83,51],[83,67],[110,80],[128,108],[42,79],[51,69]) },
  'rear-delt-flyes': { equipment: 'dumbbells',
    start: pose([51,43],[66,58],[103,77],[60,77],[55,98],[100,97],[113,113],[89,95],[83,75]),
    end: pose([51,43],[66,58],[103,77],[44,56],[23,51],[100,97],[113,113],[135,51],[104,56]) },
};

export const REST_ARTWORK: ExerciseArtwork = { equipment: 'none', bench: 'seat',
  start: pose([72,26],[74,43],[72,83],[77,64],[93,77],[104,86],[113,113]),
  end: pose([72,24],[74,41],[72,83],[77,63],[93,77],[104,86],[113,113]),
};
