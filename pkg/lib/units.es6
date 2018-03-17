/*jshint esversion: 6 */
/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

export const units = {
    B: {
        name: "B",
        base1024Exponent: 0,
    },
    KiB: {
        name: "KiB",
        base1024Exponent: 1,
    },
    MiB: {
        name: "MiB",
        base1024Exponent: 2,
    },
    GiB: {
        name: "GiB",
        base1024Exponent: 3,
    },
    TiB: {
        name: "TiB",
        base1024Exponent: 4,
    },
    PiB: {
        name: "PiB",
        base1024Exponent: 5,
    },
    EiB: {
        name: "EiB",
        base1024Exponent: 6,
    },
};

const logUnitMap = {
    '0': units.B,
    '1': units.KiB,
    '2': units.MiB,
    '3': units.GiB,
    '4': units.TiB,
    '5': units.PiB,
    '6': units.EiB,
};

function getPowerOf1024(exponent) {
    return exponent === 0 ? 1 : Math.pow(1024, exponent);
}

function getLogarithmOfBase1024(value) {
    return value > 0 ? (Math.floor(Math.log(value) / Math.log(1024))) : 0;
}

export function convertToBestUnit(input, inputUnit) {
    return convertToUnitVerbose(input, inputUnit,
        logUnitMap[getLogarithmOfBase1024(convertToUnitVerbose(input, inputUnit, units.B).value)]);
}

export function convertToUnit(input, inputUnit, outputUnit) {
    return convertToUnitVerbose(input, inputUnit, outputUnit).value;
}

export function convertToUnitVerbose(input, inputUnit, outputUnit) {
    let result = {
        value: 0,
        unit: units.B.name,
    };

    input = Number(input);
    if (isNaN(input)) {
        console.error('input is not a number');
        return result;
    }

    if (input < 0) {
        console.error(`input == ${input} cannot be less than zero`);
        return result;
    }

    let inUnit = units[(typeof inputUnit === 'string' ? inputUnit : inputUnit.name)];
    let outUnit = units[(typeof outputUnit === 'string' ? outputUnit : outputUnit.name)];

    if (!inUnit || !outUnit) {
        console.error(`unknown unit ${!inUnit ? inputUnit : outputUnit}`);
        return result;
    }

    let exponentDiff = inUnit.base1024Exponent - outUnit.base1024Exponent;
    if (exponentDiff < 0) {
        result.value = input / getPowerOf1024(-1 * exponentDiff);
    } else {
        result.value = input * getPowerOf1024(exponentDiff);
    }
    result.unit = outUnit.name;

    return result;
}
