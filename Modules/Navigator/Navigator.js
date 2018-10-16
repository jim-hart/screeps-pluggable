/**
 * Systems for managing PathFinding, CostMatrix creation and storage, and Creep
 * movement
 *
 * @module           (Navigator)
 */
'use strict';

/**
 * Holds serialized CostMatrix Instances
 * @see        {@Atlas}
 *
 * @type       {Map.<string, string>}
 */
const PACKED_COSTS = new Map();

/**
 * Holds Room.Terrain instances
 *
 * @type       {Map}
 */
const TERRAIN = new Map();

/**
 * Holds deserialized CostMatrix instances reflecting structure positions
 * @see        {@Atlas}
 *
 * @type       {Object.<string, PathFinder.CostMatrix>}
 */
const COSTS_ROOM = {};

/**
 * Holds deserialized CostMatrix instances reflecting creep and structure
 * positions
 * @see        {@Atlas}
 *
 * @type       {Object.<string, PathFinder.CostMatrix>}
 */
const COSTS_CREEP = {};

/**
 * Controls how often globally cached CostMatrix objects are deleted.  By
 * default, module level cache is cleared every 500 ticks; increase or decrease
 * as desired
 *
 * @type       {number}
 */
const RESET_FREQUENCY = 500;

/**
 * Holds current circulation of cost values set in cached/active CostMatrix
 * instances.
 *
 * The index of a cost value is used as an offset during serialization, which
 * allows both a room position and the cost value itself to be reduced to a
 * single character.
 *
 * Total entries in this array cannot exceed 22 due to .charCodeAt() range
 * @see        {@PathFinder.CostMatrix.prototype.update}
 * @see        {@PathFinder.CostMatrix.prototype.pack}
 * @see        {@Atlas.unpack}
 *
 * @type       {number[]}
 */
const OFFSETS = [];

/**
 * Used as a offset when deserializing and serializing CostMatrix instances *
 * @see        {PathFinder.CostMatrix.prototype.update}
 * @see        {PathFinder.CostMatrix.prototype.pack}
 *
 * @constant
 * @type       {number}
 */
const SPACER = 22;

/**
 * Directions constants ordered in a way to easily get the complement of a
 * different direction
 * @see        {@Navigator.isAtExpected}
 *
 *
 * @readonly
 * @type       {number[]}
 */
const COMPLIMENTS = [
    BOTTOM,
    BOTTOM_LEFT,
    LEFT,
    TOP_LEFT,
    TOP,
    TOP_RIGHT,
    RIGHT,
    BOTTOM_RIGHT,
];

/**
 * Creep.moveTo replacement
 */
class Navigator {
    /**
     * Gets creeps next move based on comparisons of previous and current game
     * states
     *
     * @param      {Creep}         creep               Owned Creep instance
     * @param      {RoomPosition}  goal                The target position
     * @param      {Object}        opts                Optional parameters for
     *                                                 customizing travel
     *                                                 behavior and path
     *                                                 generation
     * @param      {boolean}       [opts.stealth]      Allows SK room pathing;
     *                                                 attempts to find safest
     *                                                 path around SK lairs
     * @param      {boolean}       [opts.trackCreeps]  If true, creep positions
     *                                                 will be considered when
     *                                                 attempting to find a path
     *                                                 to target position
     * @return     {number}        move direction constant
     */
    static getNextMove(creep, goal, opts = {}) {
        const cache = creep.memory._nav || (creep.memory._nav = {});

        let pathError = false;
        if (!(cache.path && cache.target === positionToId(goal))) {
            pathError = true;
        } else if (this.isAtExpected(creep, cache)) {
            cache.path = cache.path.substring(1);
        } else if (cache.stuck > 2 && 50 > _.random(100) - cache.stuck) {
            pathError = opts.trackCreeps || this.moveObstruction(creep, opts);
        }
        cache.last = positionToId(creep.pos);

        if (pathError) {
            cache.path = this.getNewPath(creep, goal, cache, opts);
        }
        return +cache.path[0];
    }

    /**
     * Determines if creep successfully moved to the intended position along its
     * cached path
     *
     * @param      {Creep}    creep   The creep whose position needs to be
     *                                verified
     * @param      {Object}   cache   Creep's cached ._nav object
     * @return     {boolean}  True if creep's moved to the intended position
     *                        along its cached path
     */
    static isAtExpected(creep, cache) {
        const p1 = creep.pos;
        const p2 = positionFromId(cache.last);
        if ((isExit(p1) && isExit(p2)) || (p1.x === p2.x && p1.y === p2.y)) {
            if (++cache.stuck > 1) {
                creep.say(`:${cache.stuck}:`);
            }
            return false;
        }
        cache.stuck = 0;
        return COMPLIMENTS[+cache.path[0] - 1] === p1.getDirectionTo(p2);
    }

    /**
     * Attempts to find and move the creep that is currently blocking the
     * provided creep's path
     *
     * @param      {Creep}    creep   The creep
     * @param      {Object}   opts    PathFinding options
     * @return     {boolean}  True as long as creep's next move does not take it
     *                        to a new room
     */
    static moveObstruction(creep, opts) {
        const direction = +creep.memory._nav.path[0];

        const offsetsX = [0, 1, 1, 1, 0, -1, -1, -1];
        const offsetsY = [-1, -1, 0, 1, 1, 1, 0, -1];

        const dx = offsetsX[direction - 1] + creep.pos.x;
        const dy = offsetsY[direction - 1] + creep.pos.y;
        if (dx < 0 || dx > 49 || dy < 0 || dy > 49) {
            return false;
        }

        const other = creep.room.lookForAt(LOOK_CREEPS, dx, dy)[0];
        if (other && other.my && !(other.fatigue || other.spawning)) {
            other.move(other.pos.getDirectionTo(creep.pos));
            other.swapScheduled = Game.time;
        }
        return other ? true : (opts.trackCreeps = true);
    }

    /**
     * Creates objects needed to generate a CostMatrix that allows for safe
     * travel in a SourceKeeper room
     *
     * @param      {Room}       room    Source keeper Room
     * @return     {?Object[]}  Array of objects containing tile anchor points,
     *                          a grid size, and a cost to associate with tiles
     *                          found in that grid
     */
    static getStealthMap(room) {
        if (getRoomType(room.name) !== 'sourceKeeper') {
            return null;
        }
        const goals = room.find(FIND_SOURCES).concat(room.find(FIND_MINERALS));

        const [tiles, lairs] = [[], room.find(FIND_HOSTILE_STRUCTURES)];
        for (let i = 0; i < goals.length; i++) {
            let src = goals[i];

            let lair = src.pos.findClosestByRange(lairs);
            let walkable = getWalkableArea(src.pos, 1).map(t => {
                let pos = new RoomPosition(t[0], t[1], room.name);
                return {pos, range: pos.getRangeTo(lair)};
            });

            let closest = _.min(walkable, 'range');
            tiles.push(...walkable.filter(t => t.range === closest.range));
        }
        return [{objects: tiles, size: 3, cost: 225}];
    }

    /**
     * Returns serialized path that can be used for creep movement
     *
     * @param      {Creep}         creep   Any owned creep
     * @param      {RoomPosition}  goal    The target position
     * @param      {Object}        cache   Creep's ._nav memory object
     * @param      {Object}        opts    PathFinding customization options
     *
     * @return     {string}  Pathfinder search results converted to a string of
     *                       MOVE directions
     */
    static getNewPath(creep, goal, cache, opts) {
        cache.target = positionToId(goal);
        cache.stuck = 0;
        if (creep.memory.destination) {
            opts.heuristicWeight = 1.23;
        }
        if (opts.stealth) {
            opts.anyRoom = true;
            opts.costByArea = this.getStealthMap(creep.room);
        }
        return Cartographer.findPath(creep.pos, goal, opts);
    }
}

/**
 * Utility class for route and pathfinding generation
 */
class Cartographer {
    /**
     * Sets properties used by class instance; property assignment deferred to
     * method so class can be used as a globally accessible singleton to cut
     * down on GC costs
     *
     * @param      {RoomPosition}  start               Origin position
     * @param      {RoomPosition}  goal                Goal position
     * @param      {Object}        opts                Optional parameters for
     *                                                 customizing path
     *                                                 generation
     * @param      {boolean}       [opts.trackCreeps]  Treat creeps as
     *                                                 obstacles.
     * @param      {boolean}       [opts.stealth]      If true, path is
     *                                                 calculated up to SK rooms
     *                                                 so it will be
     *                                                 recalculated again with
     *                                                 once it has visibility
     *                                                 upon arrival obstacles.
     * @param      {boolean}       [opts.flee]         Calculate a path away
     *                                                 from the target
     * @param      {number}        [opts.range]        Explicitly defines a
     *                                                 range to target. Range is
     *                                                 automatically determined
     *                                                 if left undefined.
     * @param      {boolean}       [opts.anyRoom]      Weight all rooms equally
     *                                                 during route finding
     * @return     {string}        Pathfinder result in serialized form
     */
    static findPath(start, goal, opts = {}) {
        const distance = Game.map.getRoomLinearDistance(
            start.roomName,
            goal.roomName
        );

        let result = this.callPathFinder(start, goal, opts, distance > 2);
        if (result.incomplete) {
            console.log(
                `Path Incomplete: ${start}->${goal} ${result.path.length}`
            );
            if (!result.path.find(p => p.roomName !== start.roomName)) {
                result = this.callPathFinder(start, goal, opts);
            }
        }
        return this.serializePath(result.path, start, opts);
    }

    /**
     * Re-callable method to PathFinder.search() whose arguments are tailored
     * around current state of this.start, this.end, and this.opts
     *
     * @param      {RoomPosition}  start       Starting position
     * @param      {RoomPosition}  end         Target position
     * @param      {Object}        opts        Pathfinding options
     * @param      {boolean}       [useRoute]  If true, PathFinder will only use
     *                                         a subset of rooms when trying to
     *                                         find part to target
     * @return     {Object}        PathFinder.search() result object
     */
    static callPathFinder(start, end, opts, useRoute) {
        const goal = {
            range: 'range' in opts ? opts.range : this.getRange(end, opts),
            pos: end,
        };
        if (useRoute) {
            opts.route = this.getRoute(start.roomName, end.roomName, opts);
        }

        return PathFinder.search(start, goal, {
            roomCallback:
                opts.roomCallback ||
                (roomName => {
                    if (!opts.route || opts.route.includes(roomName)) {
                        return Atlas.getCosts(roomName, opts);
                    }
                    return false;
                }),
            plainCost: opts.plainCost || 1,
            swampCost: opts.swampCost || 5,
            flee: opts.flee,
            maxOps: opts.maxOps || 20000,
            maxRooms: useRoute ? opts.route.length : 16,
            maxCost: opts.maxCost || Infinity,
            heuristicWeight: opts.heuristicWeight || 1.2,
        });
    }

    /**
     * Returns array of roomNames that will be made available to PathFinder
     *
     * @param      {string}    start   Start position room name
     * @param      {string}    end     End position room name
     * @param      {Object}    opts    Pathfinding options
     *
     * @return     {string[]}  Array of room names Pathfinder is allowed to
     *                         search
     */
    static getRoute(start, end, opts) {
        const route = Game.map.findRoute(start, end, {
            routeCallback(name) {
                if (opts.avoid && opts.avoid.includes(name)) {
                    return Infinity;
                }
                if (opts.anyRoom || name in Memory.rooms) {
                    return 1;
                }
                const type = getRoomType(name);
                if (type === 'sourceKeeper') {
                    return Infinity;
                }
                return type === 'highway';
            },
        });
        return [start, ..._.map(route, 'room')];
    }

    /**
     * Gets the range from pos PathFinder should search up to
     *
     * @param      {RoomPosition}  goal    The target position
     * @param      {Object}        opts    PathFinding options
     * @return     {number}        The desired range to target
     */
    static getRange(goal, opts) {
        if (Atlas.isWallAt(goal.x, goal.y, goal.roomName)) {
            return 1;
        }
        if (!(goal.roomName in Game.rooms)) {
            return 0;
        }
        if (opts.trackCreeps && goal.lookFor(LOOK_CREEPS)[0]) {
            return 1;
        }
        const obstacle = goal
            .lookFor(LOOK_STRUCTURES)
            .find(
                s =>
                    s.structureType !== STRUCTURE_ROAD &&
                    s.structureType !== STRUCTURE_RAMPART &&
                    s.structureType !== STRUCTURE_CONTAINER
            );
        return obstacle ? 1 : 0;
    }

    /**
     * Converts an ordered array of RoomPositions to a serialized form suitable
     * for caching and use by Navigator() class
     *
     * @param      {RoomPosition[]}  path     Array of RoomPosition objects
     * @param      {RoomPosition}    start    The starting position
     * @param      {Object}          opts     PathFinding options
     * @return     {string}  Resulting path in string form
     */
    static serializePath(path, start, opts) {
        if (opts.stealth) {
            const index = path.findIndex(
                p => getRoomType(p.roomName) === 'sourceKeeper'
            );
            path = index !== -1 ? path.slice(0, index) : path;
        }

        let [result, current] = ['', start];
        for (let i = 0; i < path.length; i++) {
            let position = path[i];
            if (position.roomName === current.roomName) {
                result += current.getDirectionTo(position);
            }
            current = position;
        }
        return result;
    }
}

/**
 * Utility class for managing and generating CostMatrix objects
 *
 */
class Atlas {
    /**
     * Gets a CostMatrix instance associated with a room's name
     *
     * @param      {string}    id                    any valid Room.name value
     * @param      {Object}    [opts]                Optional parameters for
     *                                               customizing matrix
     *                                               generation behavior
     * @param      {Object[]}  [opts.costByArea]     Sets all positions in a NxN
     *                                               area around all provided
     *                                               objects with the same cost
     *                                               value. This can be used to
     *                                               weight positions based on
     *                                               their range to a central
     *                                               position(s).
     * @param      {boolean}   [opts.refreshMatrix]  Creates and caches a new
     *                                               CostMatrix regardless if an
     *                                               existing matrix is stored
     *                                               in costs.base
     * @param      {boolean}   [opts.trackCreeps]    If true, creep positions
     *                                               will be reflected in return
     *                                               CostMatrix instance
     *
     * @return     {PathFinder.CostMatrix}  A deserialized CostMatrix instance
     */
    static getCosts(id, opts = {}) {
        if (this.lastReset < Game.time) {
            this.reset();
        }
        if (!PACKED_COSTS.has(id) || opts.refreshMatrix) {
            this.refresh(id, opts);
        }
        if (!(id in COSTS_ROOM)) {
            COSTS_ROOM[id] = PathFinder.CostMatrix.unpack(PACKED_COSTS.get(id));
        }
        if (!(opts.trackCreeps && id in Game.rooms)) {
            return COSTS_ROOM[id];
        }
        return id in COSTS_CREEP ? COSTS_CREEP[id] : this.addCreeps(id);
    }

    /**
     * Creates and populated a new instance of PathFinder.CostMatrix() targeted
     * at Game.rooms[id];
     *
     * @param      {string}  id      Target room name
     * @param      {Object}  opts    CostMatrix generation customization options
     */
    static refresh(id, opts = {}) {
        const matrix = (COSTS_ROOM[id] = new PathFinder.CostMatrix());
        if (!(id in Game.rooms)) {
            return;
        }
        this.addStructures(Game.rooms[id], matrix);
        if (opts.costByArea) {
            this.addArea(id, matrix, opts.costByArea);
        }
        PACKED_COSTS.set(id, matrix.pack());
    }

    /**
     * Sets structure position costs in a CostMatrix object.
     *
     * @param      {Room}                   room    The target Room object
     * @param      {PathFinder.CostMatrix}  matrix  CostMatrix instance
     *                                              customization options
     */
    static addStructures(room, matrix) {
        let objects = room.find(FIND_STRUCTURES);
        if (_.size(Game.constructionSites)) {
            const sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
                filter: s => OBSTACLE_OBJECT_TYPES.includes(s.structureType),
            });
            objects.push(...sites);
        }

        for (let i = 0; i < objects.length; i++) {
            let [cost, obj] = [0, objects[i]];
            if (obj.structureType === STRUCTURE_ROAD) {
                cost = 1;
            } else if (obj.structureType === STRUCTURE_RAMPART) {
                cost = obj.my || obj.isPublic ? 0 : 255;
            } else if (obj.structureType === STRUCTURE_CONTAINER) {
                cost = 5;
            } else {
                cost = 255;
            }

            if (cost > matrix.get(obj.pos.x, obj.pos.y)) {
                matrix.update(obj.pos.x, obj.pos.y, cost);
            }
        }
    }

    /**
     * Sets costs of tiles in an area around objects in opts.costByArea
     *
     * @param      {string}                 id      The target room name
     * @param      {PathFinder.CostMatrix}  matrix  CostMatrix instance
     *
     * @param      {Object[]}  goals            Target objects and customization
     *                                          options
     * @param      {Object[]}  goals[].objects  Objects that serve as a central
     *                                          reference point for area
     *                                          generation
     * @param      {boolean}   goals[].replace  If false, existing values in
     *                                          provided matrix will not be
     *                                          overwritten
     * @param      {number}    goals[].size     The desired NxN size of the area
     *                                          to reflect
     * @param      {number}    goals[].cost     The cost to assign to each
     *                                          position within the designated
     *                                          area
     */
    static addArea(id, matrix, goals) {
        for (const goal of goals) {
            let grid = [];
            for (let i = 0; i < goal.objects.length; i++) {
                grid.push(...getWalkableArea(goal.objects[i], goal.size));
            }
            let threshold = goal.replace === false ? 1 : 255;
            for (let i = 0; i < grid.length; i++) {
                let [x, y] = grid[i];
                if (matrix.get(x, y) < threshold) {
                    matrix.update(x, y, goal.cost);
                }
            }
        }
    }

    /**
     * Reflects creep position in a CostMatrix instance
     *
     * @param      {string}                 id      The target room name
     * @return     {PathFinder.CostMatrix}  clone of CostMatrix found at
     *                                      COSTS_ROOM[id] with creep positions
     *                                      added
     */
    static addCreeps(id) {
        const matrix = COSTS_ROOM[id].clone();
        const creeps = Game.rooms[id].find(FIND_CREEPS);
        for (let i = 0; i < creeps.length; i++) {
            let pos = creeps[i].pos;
            matrix.set(pos.x, pos.y, 255);
        }
        return (COSTS_CREEP[id] = matrix);
    }

    /**
     * Gets terrain mask at x, y coordinates in a room
     *
     * @param      {number}  x         The x coordinate
     * @param      {number}  y         the y coordinate
     * @param      {string}  roomName  The room name the x,y pair sits in
     *
     * @return     {boolean}  True if wall is at (x, y) position, else false
     */
    static isWallAt(x, y, roomName) {
        if (!TERRAIN.has(roomName)) {
            TERRAIN.set(roomName, new Room.Terrain(roomName));
        }
        return TERRAIN.get(roomName).get(x, y) === TERRAIN_MASK_WALL;
    }

    /**
     * Deletes all unpacked CostMatrix instances
     */
    static reset() {
        if (Game.time % RESET_FREQUENCY === 0) {
            this.clean();
        }
        const unpacked = _.keys(COSTS_ROOM);
        for (let i = 0; i < unpacked.length; i++) {
            let roomName = unpacked[i];
            delete COSTS_ROOM[roomName];
            delete COSTS_CREEP[roomName];
        }
        // noinspection JSUnusedGlobalSymbols
        this.lastReset = Game.time;
    }

    /**
     * Deletes all serialized CostMatrix instances in PACKED_COSTS if visibility
     * is available in associated room
     */
    static clean() {
        for (const roomName of PACKED_COSTS.keys()) {
            if (!(roomName in Game.rooms)) {
                continue;
            }
            PACKED_COSTS.delete(roomName);
        }
    }
}
/**
 * Used to track tick changes in order to trigger cached matrix refreshing
 *
 * @type       {number}
 */
Atlas.lastReset = Game.time;

// ----------------------------------Helpers-----------------------------------
/**
 * Returns array of [x, y] pairs that represent a NxN grid of non-wall tiles
 *
 * @param      {RoomPosition|RoomObject}  obj           Object to serve as a
 *                                                      reference position
 * @param      {number}                   size          The desired size of the
 *                                                      grid
 * @param      {boolean}                  [allowExits]  if true, exit tiles will
 *                                                      be included in grid
 *
 * @return     {Array[]}  Array of [x, y] pairs that don't share space with a
 *                        wall
 */
function getWalkableArea(obj, size, allowExits = true) {
    const [pos, max, min] = [obj.pos || obj, Math.max, Math.min];

    const [left, right] = [max(0, pos.x - size), min(49, pos.x + size)];
    const [top, bottom] = [max(0, pos.y - size), min(49, pos.y + size)];

    const tiles = [];
    for (let x = left; x <= right; x++) {
        for (let y = top; y <= bottom; y++) {
            if (Atlas.isWallAt(x, y, pos.roomName)) {
                continue;
            }
            tiles.push([x, y]);
        }
    }
    return tiles;
}

/**
 * Gets the type of a room
 *
 * @param      {string}  roomName  The room name
 * @return     {string}  The room type (claimable, highway, or SK)
 */
function getRoomType(roomName) {
    const parsed = new RegExp('^[WE]([0-9]+)[NS]([0-9]+)$').exec(roomName);

    const [latitude, longitude] = [parsed[1] % 10, parsed[2] % 10];
    if (!(latitude && longitude)) {
        return 'highway';
    }
    if (Math.abs(latitude - 5) <= 1 && 1 >= Math.abs(longitude - 5)) {
        return 'sourceKeeper';
    }
    return 'basic';
}

/**
 * Determines if position sits on exit tile
 *
 * @param      {RoomPosition}   pos     The position
 * @return     {boolean}  True if position is an exit, else False.
 */
function isExit(pos) {
    return pos.x === 0 || pos.y === 0 || pos.x === 49 || pos.y === 49;
}

/**
 * Converts a RoomPosition to a small string suitable for storage in Memory
 *
 * @param      {RoomPosition}  pos     The position
 * @return     {string}        Position converted to a unique ID in respect to
 *                             its x, y, and roomName vlaues
 */
function positionToId(pos) {
    return String.fromCharCode(pos.x + 192, pos.y + 192) + pos.roomName;
}

/**
 * Converts a RoomPosition id value back to a RoomPosition object
 *
 * @param      {string}        id      any RoomPosition id created by
 *                                     positionToId()
 * @return     {RoomPosition}  A new RoomPosition using values pulled from id
 */
function positionFromId(id) {
    return new RoomPosition(
        id.charCodeAt(0) - 192,
        id.charCodeAt(1) - 192,
        id.substring(2)
    );
}

// ----------------------------Prototype Extensions----------------------------

Object.defineProperty(PathFinder.CostMatrix.prototype, 'costMap', {
    /**
     * Gets values that reflect modified CostMatrix positions and their
     * associated cost
     *
     * @return     {number[]}  this._bits indices with an offset added that
     *                         reflects associated cost
     */
    get: function() {
        return this._costMap || (this._costMap = []);
    },
});

/**
 * Sets the cost at the provided (x,y) position and updates this.costMap with a
 * value that reflects the modified position cost and the index it is found at
 * in this._bits
 *
 * Use this method instead of this.set() only when using this.pack() for data
 * serialization
 *
 * @param      {number}  x       x position
 * @param      {number}  y       y position
 * @param      {number}  cost    The cost
 */
PathFinder.CostMatrix.prototype.update = function(x = 0, y = 0, cost = 0) {
    const index = x * 50 + y;
    this._bits[index] = Math.min(Math.max(0, cost), 255);

    let offset = OFFSETS.indexOf(cost);
    if (offset === -1) {
        offset = OFFSETS.push(cost) - 1;
    }
    this.costMap.push(index * SPACER + offset);
};

/**
 * Translates CostMatrix to a string representing all positions in room where
 * the associated cost is > 0
 *
 *
 * @return     {string}  Serialized form of CostMatrix in its current state
 */
PathFinder.CostMatrix.prototype.pack = function() {
    // for when this.costMap is pre-populated by this.update()
    if (this.costMap.length > 0) {
        return String.fromCharCode(...this.costMap);
    }

    for (let i = 0; i < this._bits.length; i++) {
        let cost = this._bits[i];
        if (cost === 0) {
            continue;
        }

        let offset = OFFSETS.indexOf(cost);
        if (offset === -1) {
            offset = OFFSETS.push(cost) - 1;
        }
        this.costMap.push(i * SPACER + offset);
    }
    return String.fromCharCode(...this.costMap);
};

/**
 * Provides interface to Navigator() class and acts as a replacement for moveTo
 *
 * @param      {RoomObject|RoomPosition}  target  travel destination
 * @param      {Object}    [opts]  Navigator, Cartographer, and Atlas options
 */
Creep.prototype.navigateTo = function(target, opts) {
    this.move(Navigator.getNextMove(this, target.pos || target, opts));
};
