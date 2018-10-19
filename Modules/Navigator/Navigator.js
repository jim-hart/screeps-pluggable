/**
 * Systems for managing PathFinding, CostMatrix creation and storage, and Creep
 * movement
 *
 * @module           (Navigator)
 */
'use strict';

// ---------------------------MODULE LEVEL VARIABLES---------------------------
/**
 * Holds serialized CostMatrix Instances
 * @see        {@Atlas}
 *
 * @type       {Map.<string, string>}
 */
const PACKED_COSTS = new Map();

/**
 * Holds Room.Terrain instances
 * @see        {@Atlas}
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
 * @see        {@Atlas}
 *
 * @type       {number}
 */
const RESET_FREQUENCY = 500;

/**
 * Used for checking for checking against reserved room
 * @see        {@Cartographer}
 *
 * @constant
 * @type       {string}
 */
const USERNAME = (_.find(Game.structures) || {owner: ''}).owner.username;

/**
 * Directions constants ordered in a way to easily get the complement of a
 * different direction
 * @see        {@Navigator.isAtExpected}
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
 * @see        {@PathFinder.CostMatrix.unpack}
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

// ---------------------------------NAVIGATOR----------------------------------
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
     * @param      {*}             [opts.*]            Any optional parameter
     *                                                 supported by
     *                                                 PathFinder.search()
     *
     * @return     {number}  move direction constant
     */
    static getNextMove(creep, goal, opts = {}) {
        const cache = creep.memory._nav || (creep.memory._nav = {});

        let pathError = false;
        if (!(cache.path && cache.target === this.positionToId(goal))) {
            pathError = true;
        } else if (this.isAtExpected(creep, cache)) {
            cache.path = cache.path.substring(1);
        } else if (cache.stuck > 2 && 50 > _.random(100) - cache.stuck) {
            pathError = opts.trackCreeps || this.moveObstruction(creep, opts);
        }
        cache.last = this.positionToId(creep.pos);

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
        const p2 = this.positionFromId(cache.last);

        let isExit = p1.x === 0 || p2.x === 0 || p1.y === 49 || p2.y === 49;
        if (isExit || (p1.x === p2.x && p1.y === p2.y)) {
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
            let walkable = Atlas.getWalkableArea(src.pos, 1).map(t => {
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
        cache.target = this.positionToId(goal);
        cache.stuck = 0;
        if (opts.stealth) {
            opts.anyRoom = true;
            opts.addArea = this.getStealthMap(creep.room);
        }
        return Cartographer.findPath(creep.pos, goal, opts);
    }

    /**
     * Converts a RoomPosition to a small string suitable for storage in Memory
     *
     * @param      {RoomPosition}  pos     The position
     * @return     {string}        Position converted to a unique ID in respect
     *                             to its x, y, and roomName vlaues
     */
    static positionToId(pos) {
        return String.fromCharCode(pos.x + 192, pos.y + 192) + pos.roomName;
    }

    /**
     * Converts a RoomPosition id value back to a RoomPosition object
     *
     * @param      {string}        id      any RoomPosition id created by
     *                                     positionToId()
     * @return     {RoomPosition}  A new RoomPosition using values pulled from
     *                             id
     */
    static positionFromId(id) {
        return new RoomPosition(
            id.charCodeAt(0) - 192,
            id.charCodeAt(1) - 192,
            id.substring(2)
        );
    }
}

// --------------------------------CARTOGRAPHER--------------------------------
class Cartographer {
    /**
     * Sets properties used by class instance; property assignment deferred to
     * method so class can be used as a globally accessible singleton to cut
     * down on GC costs
     *
     * @param      {RoomPosition}  start   Origin position
     * @param      {RoomPosition}  goal    Goal position
     *
     * @param      {Object}   opts                Optional parameters for
     *                                            customizing path generation
     * @param      {boolean}  [opts.trackCreeps]  Treat creeps as obstacles.
     * @param      {boolean}  [opts.anyRoom]      Weight all rooms equally
     *                                            during route finding
     * @param      {boolean}  [opts.serialize]    If explcitly provided as
     *                                            false, the resulting path
     *                                            won't be serialized and the
     *                                            array of RoomPosition objects
     *                                            will be returned instead
     *
     * @return     {string|RoomPosition[]}  Pathfinder.search().path result
     */
    static findPath(start, goal, opts = {}) {
        const [r1, r2] = [start.roomName, goal.roomName];
        const distance = Game.map.getRoomLinearDistance(r1, r2);

        let route = distance > 2 ? this.findRoute(r1, r2, opts) : null;
        let result = this.callPathFinder(start, goal, opts, route);
        if (result.incomplete && distance <= 2) {
            route = this.findRoute(r1, r2, opts);
            result = this.callPathFinder(start, goal, opts, route);
        }
        if (result.incomplete) {
            console.log(`Path Incomplete: ${start}->${goal}`);
        }

        let path = result.path;
        if (opts.stealth) {
            const index = path.findIndex(
                p => getRoomType(p.roomName) === 'sourceKeeper'
            );
            path = index !== -1 ? path.slice(0, index) : path;
        }

        if (opts.serialize === false) {
            return path;
        }
        return this.serializePath(path, start, opts);
    }

    /**
     * Re-callable method to PathFinder.search() whose arguments are tailored
     * around current state of this.start, this.end, and this.opts
     *
     * @param      {RoomPosition}  start   Starting position
     * @param      {RoomPosition}  end     Target position
     * @param      {Object}        opts    Pathfinding options
     * @param      {string[]}      route   Array of room names PathFinder is
     *                                     allowed to search
     * @return     {Object}        PathFinder.search() result object
     */
    static callPathFinder(start, end, opts, route) {
        const goal = {range: this.getRange(end, opts), pos: end};

        return PathFinder.search(start, goal, {
            roomCallback:
                opts.roomCallback ||
                (roomName => {
                    if (route && !route.includes(roomName)) {
                        return false;
                    }
                    if (opts.avoid && opts.avoid.includes(roomName)) {
                        return false;
                    }
                    return Atlas.getCosts(roomName, opts);
                }),
            plainCost: opts.plainCost || 3,
            swampCost: opts.swampCost || 7,
            flee: opts.flee,
            maxOps: opts.maxOps || 20000,
            maxRooms: opts.maxRooms || (route ? route.length : 16),
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
            routeCallback(roomName) {
                if (opts.avoid && opts.avoid.includes(roomName)) {
                    return Infinity;
                }
                if (opts.anyRoom || isMyRoom(roomName)) {
                    return 1;
                }
                const type = getRoomType(roomName);
                if (type === 'sourceKeeper') {
                    return Infinity;
                }
                return type === 'highway' ? 1 : 2;
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
        if ('range' in opts) {
            return opts.range;
        }
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
                    s.structureType !== STRUCTURE_CONTAINER
            );
        return obstacle ? 1 : 0;
    }

    /**
     * Converts an ordered array of RoomPositions to a serialized form suitable
     * for caching and use by Navigator() class
     *
     * @param      {RoomPosition[]}  path    Array of RoomPosition objects
     * @param      {RoomPosition}    start   The starting position
     * @param      {Object}          opts    PathFinding options
     * @return     {string}          Resulting path in string form
     */
    static serializePath(path, start, opts) {
        let [result, current, last] = ['', start, path.length];
        for (let i = 0; i < path.length; i++) {
            let position = path[i];
            if (position.roomName === current.roomName) {
                result += current.getDirectionTo(position);
            } else if (current.roomName === start.roomName) {
                last = i;
            }
            current = position;
        }

        if (opts.visualizePathStyle) {
            this.visualizePath(path, start, opts, exit);
        }
        return result;
    }

    /**
     * Creates a poly visual for all RoomPositions found in starting room
     *
     * @param      {RoomPosition[]}  path    PathFinder.search() result path
     * @param      {RoomPosition}    start   The starting position
     * @param      {Object}          opts    PathFinding options
     * @param      {number}          last    Number representing the index the
     *                                       provided path shoudl be sliced up
     *                                       to to exlcude positions not in
     *                                       starting room
     */
    static visualizePath(path, start, opts, last = 0) {
        if (last === 0) {
            last = path.findIndex(p => p.roomName !== start.roomName);
        }
        new RoomVisual(start.roomName).poly(
            last > 0 && last < path.length ? path.slice(0, last) : path,
            _.defaults(opts.visualizePathStyle, {
                opacity: 1,
                stroke: 'aqua',
                lineStlye: 'dashed',
            })
        );
    }

    /**
     * Gets the type of a room
     *
     * @param      {string}  roomName  The room name
     * @return     {string}  The room type (claimable, highway, or SK)
     */
    static getRoomType(roomName) {
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
     * Determines if room is either owned or reserved by player running this
     * code
     *
     * @param      {string}   roomName  The room name
     * @return     {boolean}  True if room is owned or reserved by self, else
     *                        false
     */
    static isMyRoom(roomName) {
        const room = Game.rooms[roomName];
        if (!(room && room.controller)) {
            return false;
        }
        const controller = room.controller;
        if (!(controller.my || controller.reservation)) {
            return false;
        }
        return controller.my || controller.reservation.username === USERNAME;
    }
}

// -----------------------------------ATLAS------------------------------------
class Atlas {
    /**
     * Gets a CostMatrix instance associated with a room's name
     *
     * @param      {string}    id                    any valid Room.name value
     * @param      {Object}    [opts]                Optional parameters for
     *                                               customizing matrix
     *                                               generation behavior
     * @param      {boolean}   [opts.trackCreeps]    If true, treat creep
     *                                               positions as unwalkable
     * @param      {boolean}   [opts.refreshMatrix]  Creates and caches a new
     *                                               CostMatrix regardless if an
     *                                               existing matrix is stored
     *                                               in costs.base
     * @param      {Object[]}  [opts.addArea]        Sets all positions in a NxN
     *                                               area around all provided
     *                                               objects with the same cost
     *                                               value. This can be used to
     *                                               weight positions based on
     *                                               their range to a central
     *                                               position(s).
     *
     * @return     {PathFinder.CostMatrix}  A deserialized CostMatrix instance
     */
    static getCosts(id, opts = {}) {
        if (this.lastReset < Game.time) {
            this._reset();
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
        return id in COSTS_CREEP ? COSTS_CREEP[id] : this._addCreeps(id);
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
        this._addStructures(Game.rooms[id], matrix);
        if (opts.addArea) {
            this._addArea(id, matrix, opts.addArea);
        }
        PACKED_COSTS.set(id, matrix.pack());
    }

    /**
     * Returns array of [x, y] pairs that represent a NxN grid of non-wall tiles
     *
     * @param      {RoomPosition|RoomObject}  obj           Object to serve as a
     *                                                      reference position
     * @param      {number}                   size          The desired size of
     *                                                      the grid
     * @param      {boolean}                  [allowExits]  if true, exit tiles
     *                                                      will be included in
     *                                                      grid
     *
     * @return     {Array[]}  Array of [x, y] pairs that don't share space with
     *                        a wall
     */
    static getWalkableArea(obj, size, allowExits = true) {
        const [pos, max, min] = [obj.pos || obj, Math.max, Math.min];

        const [left, right] = [max(0, pos.x - size), min(49, pos.x + size)];
        const [top, bottom] = [max(0, pos.y - size), min(49, pos.y + size)];

        const tiles = [];
        for (let x = left; x <= right; x++) {
            for (let y = top; y <= bottom; y++) {
                if (this.isWallAt(x, y, pos.roomName)) {
                    continue;
                }
                tiles.push([x, y]);
            }
        }
        return tiles;
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
     * Sets structure position costs in a CostMatrix object.
     *
     * @private
     * @param      {Room}                   room    The target Room object
     * @param      {PathFinder.CostMatrix}  matrix  CostMatrix instance
     *                                              customization options
     */
    static _addStructures(room, matrix) {
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
     * Sets costs of tiles in an area around objects in opts.addArea
     *
     * @private
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
    static _addArea(id, matrix, goals) {
        for (const goal of goals) {
            let grid = [];
            for (let i = 0; i < goal.objects.length; i++) {
                grid.push(...this.getWalkableArea(goal.objects[i], goal.size));
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
     * @private
     * @param      {string}                 id      The target room name
     * @return     {PathFinder.CostMatrix}  clone of CostMatrix found at
     *                                      COSTS_ROOM[id] with creep positions
     *                                      added
     */
    static _addCreeps(id) {
        const matrix = COSTS_ROOM[id].clone();
        const creeps = Game.rooms[id].find(FIND_CREEPS);
        for (let i = 0; i < creeps.length; i++) {
            let pos = creeps[i].pos;
            matrix.set(pos.x, pos.y, 255);
        }
        return (COSTS_CREEP[id] = matrix);
    }

    /**
     * Deletes all unpacked CostMatrix instances
     * @private
     */
    static _reset() {
        if (Game.time % RESET_FREQUENCY === 0) {
            for (const roomName of PACKED_COSTS.keys()) {
                if (!(roomName in Game.rooms)) {
                    continue;
                }
                PACKED_COSTS.delete(roomName);
            }
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
}
Atlas.lastReset = Game.time;

// ---------------------------------PROTOTYPES---------------------------------
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
 * Converts an encoded CostMatrix string back to its original form
 *
 * @static
 * @param      {string}  packed  A CostMatrix in its serialized, encoded form
 *
 * @return     {PathFinder.CostMatrix}  CostMatrix instance with position costs
 *                                      pulled from the encoded string
 */
PathFinder.CostMatrix.unpack = function(packed) {
    let [codec, start] = [OFFSETS, 0];
    if (packed[0] === TRIGGER) {
        codec = [];
        for (let i = 2; i < 2 + parseInt(packed[1], 10); i++) {
            codec.push(packed.charCodeAt(i));
        }
        start += codec.length + 2;
    }

    const matrix = new PathFinder.CostMatrix();
    for (let i = start; i < packed.length; i++) {
        let value = packed.charCodeAt(i);
        matrix._bits[(value / SPACER) | 0] = codec[value % SPACER];
    }
    return matrix;
};

/**
 * Provides interface to Navigator() class and acts as a replacement for moveTo
 *
 * @param      {RoomObject|RoomPosition}  target  travel destination
 * @param      {Object}    [opts]  Navigator, Cartographer, and Atlas options
 */
Creep.prototype.navigateTo = function(target, opts) {
    if (this.fatigue || this.swapScheduled) {
        return;
    }
    this.move(Navigator.getNextMove(this, target.pos || target, opts));
};
