/**
 * CostMatrix management system
 *
 * @module     (Atlas)
 */
'use strict';

/**
 * Attempts to used Packed.js prototypes for CostMatrix compression.  If not
 * founds, API names are aliased and used instead
 */
(function() {
    try {
        require('Packed');
    } catch (e) {
        console.log('Atlas: Packed.js not found, defaulting to API methods');
        const P = PathFinder;
        P.CostMatrix.prototype.update = P.CostMatrix.prototype.set;
        P.CostMatrix.prototype.pack = P.CostMatrix.prototype.serialize;
        P.CostMatrix.unpack = P.CostMatrix.deserialize;
    }
})();

/**
 * Holds serialized CostMatrix Instances
 *
 * @type       {Map.<string, string>}
 * @see        {@Atlas}
 */
const PACKED_COSTS = new Map();

/**
 * Holds deserialized CostMatrix instances reflecting structure positions
 *
 * @type       {Object.<string, PathFinder.CostMatrix>}
 * @see        {@Atlas}
 */
const COSTS_ROOM = {};

/**
 * Holds deserialized CostMatrix instances reflecting creep and structure
 * positions
 *
 * @type       {Object.<string, PathFinder.CostMatrix>}
 * @see        {@Atlas}
 */
const COSTS_CREEP = {};

/**
 * Holds Room.Terrain instances
 *
 * @type       {Map}
 */
const TERRAIN = new Map();

/**
 * Controls how often globally cached CostMatrix objects are deleted.  By
 * default, module level cache is cleared every 500 ticks; increase or decrease
 * as desired
 *
 * @type       {number}
 */
const RESET_FREQUENCY = 500;

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

module.exports = Atlas;
