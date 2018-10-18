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
        console.log(
            'Cartographer: Atlas not found, using generic callback instead'
        );
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
     * @param      {boolean}       [opts.anyRoom]      Weight all rooms equally
     *                                                 during route finding
     *
     * @return     {string}  Pathfinder result in serialized form
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
        return this.serializePath(result.path, start, opts);
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
        const goal = {
            range: 'range' in opts ? opts.range : this.getRange(end, opts),
            pos: end,
        };

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
            plainCost: opts.plainCost || 1,
            swampCost: opts.swampCost || 5,
            flee: opts.flee,
            maxOps: opts.maxOps || 20000,
            maxRooms: opts.maxRooms || (useRoute ? opts.route.length : 16),
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

module.exports = Cartographer;
