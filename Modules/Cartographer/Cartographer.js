/**
 * System assumes Atlas.js inlcuded with project; else, a generic fallback is
 * used.  This can be reassigned to your own callback function as well.
 *
 * @class      Atlas (name)
 */
const Atlas = (function() {
    let costManager;
    try {
        costManager = require('Atlas');
    } catch (e) {
        console.log('Cartographer: Atlas not found, falling back to generic');
        costManager = {
            getCosts: genericCostCallback,
            isWallAt: function(x, y, roomName) {
                const terrain = new Room.Terrain(roomName);
                return terrain.get(x, y) === TERRAIN_MASK_WALL;
            },
        };
    }
    return costManager;
})();

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
 * A basic callback function for PathFinder if Atlas isn't being used.
 *
 * @param      {string}                 roomName  The room name
 * @return     {PathFinder.CostMatrix}  CostMatrix instance reflecting structure
 *                                      costs in room
 */
function genericCostCallback(roomName) {
    if (!(roomName in Game.rooms)) {
        return;
    }
    const room = Game.rooms[roomName];
    const objects = room.find(FIND_STRUCTURES);

    const matrix = new PathFinder.CostMatrix();
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
            matrix.set(obj.pos.x, obj.pos.y, cost);
        }
    }
    return matrix;
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
                const type = utils.getRoomType(name);
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
                p => utils.getRoomType(p.roomName) === 'sourceKeeper'
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

module.exports = Cartographer;
