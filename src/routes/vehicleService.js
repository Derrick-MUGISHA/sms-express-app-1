const express = require('express');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();
const prisma = new PrismaClient();


const VEHICLE_TYPES         = ['ELECTRIC', 'SUV', 'TRUCK', 'MOTORCYCLE', 'BUS', 'VAN', 'PICKUP', 'OTHER'];
const FUEL_TYPES            = ['PETROL', 'DIESEL', 'ELECTRIC', 'HYBRID', 'GAS', 'OTHER'];
const VEHICLE_PURPOSES      = ['PERSONAL', 'COMMERCIAL', 'TAXI', 'GOVERNMENT'];
const VEHICLE_STATUSES      = ['NEW', 'USED', 'REBUILT'];
const OWNER_TYPES           = ['INDIVIDUAL', 'COMPANY', 'NGO', 'GOVERNMENT'];
const PLATE_TYPES           = ['PRIVATE', 'COMMERCIAL', 'GOVERNMENT', 'DIPLOMATIC', 'PERSONALIZED'];
const REGISTRATION_STATUSES = ['ACTIVE', 'SUSPENDED', 'EXPIRED', 'PENDING'];
const INSURANCE_STATUSES    = ['ACTIVE', 'EXPIRED', 'CANCELLED'];


const RW_PLATE_REGEX = /^(R[A-Z]{2}|GR|CD)\s?\d{3}\s?[A-Z]?$/i;
const EMAIL_REGEX    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isDateInPast(dateStr) {
  return new Date(dateStr) < new Date();
}


function validateVehicle(req, res, next) {
  const errors = [];
  const d = req.body;

  // Vehicle Info
  if (!d.manufacture || !d.manufacture.trim())
    errors.push('manufacture is required.');
  if (!d.model || !d.model.trim())
    errors.push('model is required.');
  if (!Number.isInteger(d.year) || d.year < 1886 || d.year > new Date().getFullYear() + 1)
    errors.push(`year must be an integer between 1886 and ${new Date().getFullYear() + 1}.`);
  if (!d.vehicleType || !VEHICLE_TYPES.includes(d.vehicleType))
    errors.push(`vehicleType must be one of: ${VEHICLE_TYPES.join(', ')}.`);
  if (!d.bodyType || !d.bodyType.trim())
    errors.push('bodyType is required.');
  if (!d.color || !d.color.trim())
    errors.push('color is required.');
  if (!d.fuelType || !FUEL_TYPES.includes(d.fuelType))
    errors.push(`fuelType must be one of: ${FUEL_TYPES.join(', ')}.`);
  if (!Number.isInteger(d.engineCapacity) || d.engineCapacity <= 0)
    errors.push('engineCapacity must be a positive integer (cc).');
  if (!Number.isInteger(d.odometerReading) || d.odometerReading < 0)
    errors.push('odometerReading must be a non-negative integer.');
  if (!Number.isInteger(d.seatingCapacity) || d.seatingCapacity < 1)
    errors.push('seatingCapacity must be a positive integer.');
  if (!d.vehiclePurpose || !VEHICLE_PURPOSES.includes(d.vehiclePurpose))
    errors.push(`vehiclePurpose must be one of: ${VEHICLE_PURPOSES.join(', ')}.`);
  if (!d.vehicleStatus || !VEHICLE_STATUSES.includes(d.vehicleStatus))
    errors.push(`vehicleStatus must be one of: ${VEHICLE_STATUSES.join(', ')}.`);

  // Owner Info
  if (!d.ownerName || !d.ownerName.trim())
    errors.push('ownerName is required.');
  if (!d.ownerType || !OWNER_TYPES.includes(d.ownerType))
    errors.push(`ownerType must be one of: ${OWNER_TYPES.join(', ')}.`);
  if (!d.nationalId || !/^\d{16}$/.test(d.nationalId))
    errors.push('nationalId must be exactly 16 digits.');
  if (d.passportNumber !== undefined && d.passportNumber !== null && typeof d.passportNumber === 'string' && !d.passportNumber.trim())
    errors.push('passportNumber, if provided, must be a non-empty string.');
  if (d.ownerType === 'COMPANY' && (!d.companyRegNumber || !d.companyRegNumber.trim()))
    errors.push('companyRegNumber is required for COMPANY ownerType.');
  if (!d.address || !d.address.trim())
    errors.push('address is required.');
  if (!d.mobile || !/^\d{10}$/.test(d.mobile))
    errors.push('mobile must be exactly 10 digits.');
  if (!d.email || !EMAIL_REGEX.test(d.email))
    errors.push('email must be a valid email address.');

  // Registration
  if (d.plateNumber && !RW_PLATE_REGEX.test(d.plateNumber))
    errors.push('plateNumber must be a valid Rwandan plate (e.g. RAA 123 B, GR 456 C).');
  if (d.registrationStatus && !REGISTRATION_STATUSES.includes(d.registrationStatus))
    errors.push(`registrationStatus must be one of: ${REGISTRATION_STATUSES.join(', ')}.`);
  if (!d.registrationDate || isNaN(new Date(d.registrationDate).getTime()))
    errors.push('registrationDate must be a valid date-time string.');
  if (!d.expiryDate || isNaN(new Date(d.expiryDate).getTime()))
    errors.push('expiryDate must be a valid date-time string.');
  else if (isDateInPast(d.expiryDate))
    errors.push('expiryDate must not be in the past.');
  if (!d.state || !d.state.trim())
    errors.push('state is required.');
  if (!d.plateType || !PLATE_TYPES.includes(d.plateType))
    errors.push(`plateType must be one of: ${PLATE_TYPES.join(', ')}.`);

  // Insurance
  if (!d.policyNumber || !d.policyNumber.trim())
    errors.push('policyNumber is required.');
  if (!d.companyName || !d.companyName.trim())
    errors.push('companyName (insurer) is required.');
  if (!d.insuranceExpiryDate || isNaN(new Date(d.insuranceExpiryDate).getTime()))
    errors.push('insuranceExpiryDate must be a valid date-time string.');
  else if (isDateInPast(d.insuranceExpiryDate))
    errors.push('insuranceExpiryDate must not be in the past.');
  if (d.insuranceStatus && !INSURANCE_STATUSES.includes(d.insuranceStatus))
    errors.push(`insuranceStatus must be one of: ${INSURANCE_STATUSES.join(', ')}.`);
  if (!d.insuranceType || !d.insuranceType.trim())
    errors.push('insuranceType is required.');
  if (!d.roadworthyCert || !d.roadworthyCert.trim())
    errors.push('roadworthyCert is required.');
  if (!d.customsRef || !d.customsRef.trim())
    errors.push('customsRef is required.');
  if (!d.proofOfOwnership || !d.proofOfOwnership.trim())
    errors.push('proofOfOwnership is required.');

  if (errors.length > 0) return res.status(422).json({ errors });
  next();
}


function validateVehicleUpdate(req, res, next) {
  const errors = [];
  const d = req.body;

  if (d.year !== undefined && (!Number.isInteger(d.year) || d.year < 1886 || d.year > new Date().getFullYear() + 1))
    errors.push(`year must be an integer between 1886 and ${new Date().getFullYear() + 1}.`);
  if (d.vehicleType !== undefined && !VEHICLE_TYPES.includes(d.vehicleType))
    errors.push(`vehicleType must be one of: ${VEHICLE_TYPES.join(', ')}.`);
  if (d.fuelType !== undefined && !FUEL_TYPES.includes(d.fuelType))
    errors.push(`fuelType must be one of: ${FUEL_TYPES.join(', ')}.`);
  if (d.vehiclePurpose !== undefined && !VEHICLE_PURPOSES.includes(d.vehiclePurpose))
    errors.push(`vehiclePurpose must be one of: ${VEHICLE_PURPOSES.join(', ')}.`);
  if (d.vehicleStatus !== undefined && !VEHICLE_STATUSES.includes(d.vehicleStatus))
    errors.push(`vehicleStatus must be one of: ${VEHICLE_STATUSES.join(', ')}.`);
  if (d.ownerType !== undefined && !OWNER_TYPES.includes(d.ownerType))
    errors.push(`ownerType must be one of: ${OWNER_TYPES.join(', ')}.`);
  if (d.nationalId !== undefined && !/^\d{16}$/.test(d.nationalId))
    errors.push('nationalId must be exactly 16 digits.');
  if (d.mobile !== undefined && !/^\d{10}$/.test(d.mobile))
    errors.push('mobile must be exactly 10 digits.');
  if (d.email !== undefined && !EMAIL_REGEX.test(d.email))
    errors.push('email must be a valid email address.');
  if (d.plateNumber !== undefined && d.plateNumber !== null && !RW_PLATE_REGEX.test(d.plateNumber))
    errors.push('plateNumber must be a valid Rwandan plate (e.g. RAA 123 B).');
  if (d.registrationStatus !== undefined && !REGISTRATION_STATUSES.includes(d.registrationStatus))
    errors.push(`registrationStatus must be one of: ${REGISTRATION_STATUSES.join(', ')}.`);
  if (d.plateType !== undefined && !PLATE_TYPES.includes(d.plateType))
    errors.push(`plateType must be one of: ${PLATE_TYPES.join(', ')}.`);
  if (d.expiryDate !== undefined) {
    if (isNaN(new Date(d.expiryDate).getTime())) errors.push('expiryDate must be a valid date.');
    else if (isDateInPast(d.expiryDate))          errors.push('expiryDate must not be in the past.');
  }
  if (d.insuranceStatus !== undefined && !INSURANCE_STATUSES.includes(d.insuranceStatus))
    errors.push(`insuranceStatus must be one of: ${INSURANCE_STATUSES.join(', ')}.`);
  if (d.insuranceExpiryDate !== undefined) {
    if (isNaN(new Date(d.insuranceExpiryDate).getTime())) errors.push('insuranceExpiryDate must be a valid date.');
    else if (isDateInPast(d.insuranceExpiryDate))          errors.push('insuranceExpiryDate must not be in the past.');
  }

  if (errors.length > 0) return res.status(422).json({ errors });
  next();
}



/**
 * @swagger
 * components:
 *   schemas:
 *     ValidationError:
 *       type: object
 *       properties:
 *         errors:
 *           type: array
 *           items:
 *             type: string
 *           example:
 *             - "nationalId must be exactly 16 digits."
 *             - "mobile must be exactly 10 digits."
 *             - "expiryDate must not be in the past."
 *
 *     VehicleInput:
 *       type: object
 *       required:
 *         - manufacture
 *         - model
 *         - year
 *         - vehicleType
 *         - bodyType
 *         - color
 *         - fuelType
 *         - engineCapacity
 *         - odometerReading
 *         - seatingCapacity
 *         - vehiclePurpose
 *         - vehicleStatus
 *         - ownerName
 *         - ownerType
 *         - nationalId
 *         - passportNumber
 *         - companyRegNumber
 *         - address
 *         - mobile
 *         - email
 *         - registrationDate
 *         - expiryDate
 *         - state
 *         - plateType
 *         - policyNumber
 *         - companyName
 *         - insuranceExpiryDate
 *         - insuranceType
 *         - roadworthyCert
 *         - customsRef
 *         - proofOfOwnership
 *       properties:
 *         manufacture:
 *           type: string
 *           example: Toyota
 *         model:
 *           type: string
 *           example: Corolla
 *         year:
 *           type: integer
 *           minimum: 1886
 *           example: 2020
 *         vehicleType:
 *           type: string
 *           enum: [ELECTRIC, SUV, TRUCK, MOTORCYCLE, BUS, VAN, PICKUP, OTHER]
 *           example: SUV
 *         bodyType:
 *           type: string
 *           example: Sedan
 *         color:
 *           type: string
 *           example: White
 *         fuelType:
 *           type: string
 *           enum: [PETROL, DIESEL, ELECTRIC, HYBRID, GAS, OTHER]
 *           example: PETROL
 *         engineCapacity:
 *           type: integer
 *           minimum: 1
 *           description: Engine displacement in cc
 *           example: 1800
 *         odometerReading:
 *           type: integer
 *           minimum: 0
 *           example: 45000
 *         seatingCapacity:
 *           type: integer
 *           minimum: 1
 *           example: 5
 *         vehiclePurpose:
 *           type: string
 *           enum: [PERSONAL, COMMERCIAL, TAXI, GOVERNMENT]
 *           example: PERSONAL
 *         vehicleStatus:
 *           type: string
 *           enum: [NEW, USED, REBUILT]
 *           example: USED
 *         ownerName:
 *           type: string
 *           example: Jean Pierre Habimana
 *         ownerType:
 *           type: string
 *           enum: [INDIVIDUAL, COMPANY, NGO, GOVERNMENT]
 *           example: INDIVIDUAL
 *         nationalId:
 *           type: string
 *           pattern: '^\d{16}$'
 *           description: Must be exactly 16 digits
 *           example: "1199880012345678"
 *         passportNumber:
 *           type: string
 *           example: PC1234567
 *         companyRegNumber:
 *           type: string
 *           description: Required when ownerType is COMPANY
 *           example: RWA/2023/00123
 *         address:
 *           type: string
 *           example: KG 123 St, Kigali
 *         mobile:
 *           type: string
 *           pattern: '^\d{10}$'
 *           description: Must be exactly 10 digits
 *           example: "0788123456"
 *         email:
 *           type: string
 *           format: email
 *           example: jean.pierre@example.rw
 *         plateNumber:
 *           type: string
 *           pattern: '^(R[A-Z]{2}|GR|CD)\s?\d{3}\s?[A-Z]?$'
 *           description: "Valid Rwandan plate: RAA 123 B, GR 456 C, CD 789"
 *           example: RAA 123 B
 *         registrationStatus:
 *           type: string
 *           enum: [ACTIVE, SUSPENDED, EXPIRED, PENDING]
 *           example: ACTIVE
 *         registrationDate:
 *           type: string
 *           format: date-time
 *           example: "2023-01-15T00:00:00.000Z"
 *         expiryDate:
 *           type: string
 *           format: date-time
 *           description: Must not be in the past
 *           example: "2026-01-15T00:00:00.000Z"
 *         state:
 *           type: string
 *           example: Kigali
 *         plateType:
 *           type: string
 *           enum: [PRIVATE, COMMERCIAL, GOVERNMENT, DIPLOMATIC, PERSONALIZED]
 *           example: PRIVATE
 *         policyNumber:
 *           type: string
 *           example: POL-2024-00456
 *         companyName:
 *           type: string
 *           description: Insurance company name
 *           example: SANLAM Insurance Rwanda
 *         insuranceExpiryDate:
 *           type: string
 *           format: date-time
 *           description: Must not be in the past
 *           example: "2026-06-30T00:00:00.000Z"
 *         insuranceStatus:
 *           type: string
 *           enum: [ACTIVE, EXPIRED, CANCELLED]
 *           example: ACTIVE
 *         insuranceType:
 *           type: string
 *           example: Comprehensive
 *         roadworthyCert:
 *           type: string
 *           example: RWC-2024-78901
 *         customsRef:
 *           type: string
 *           example: CUS-RW-2023-11223
 *         proofOfOwnership:
 *           type: string
 *           example: LOG-BOOK-2024-XYZ
 */

/**
 * @swagger
 * tags:
 *   name: Vehicle
 *   description: Vehicle management
 */



/**
 * @swagger
 * /api/vehicle-service/vehicle:
 *   post:
 *     summary: Create a new vehicle
 *     tags: [Vehicle]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VehicleInput'
 *     responses:
 *       201:
 *         description: Vehicle created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VehicleInput'
 *       422:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       500:
 *         description: Internal server error
 */
router.post('/vehicle', validateVehicle, async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.create({ data: req.body });
    res.status(201).json(vehicle);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create vehicle' });
  }
});



/**
 * @swagger
 * /api/vehicle-service/vehicle:
 *   get:
 *     summary: Get all vehicles
 *     tags: [Vehicle]
 *     responses:
 *       200:
 *         description: List of all vehicles
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/VehicleInput'
 *       500:
 *         description: Internal server error
 */
router.get('/vehicle', async (req, res) => {
  try {
    const vehicles = await prisma.vehicle.findMany();
    res.json(vehicles);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch vehicles' });
  }
});



/**
 * @swagger
 * /api/vehicle-service/vehicle/{id}:
 *   get:
 *     summary: Get full vehicle record by ID
 *     tags: [Vehicle]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the vehicle
 *     responses:
 *       200:
 *         description: Vehicle retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VehicleInput'
 *       404:
 *         description: Vehicle not found
 *         content:
 *           application/json:
 *             example:
 *               error: Vehicle not found
 *       500:
 *         description: Internal server error
 */
router.get('/vehicle/:id', async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: req.params.id }
    });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(vehicle);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch vehicle' });
  }
});



/**
 * @swagger
 * /api/vehicle-service/vehicle/{id}/info:
 *   get:
 *     summary: Get vehicle technical info by ID
 *     tags: [Vehicle]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Vehicle info retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   example: "64f1a2b3c4d5e6f7a8b9c0d1"
 *                 manufacture:
 *                   type: string
 *                   example: Toyota
 *                 model:
 *                   type: string
 *                   example: Corolla
 *                 year:
 *                   type: integer
 *                   example: 2020
 *                 vehicleType:
 *                   type: string
 *                   enum: [ELECTRIC, SUV, TRUCK, MOTORCYCLE, BUS, VAN, PICKUP, OTHER]
 *                   example: SUV
 *                 bodyType:
 *                   type: string
 *                   example: Sedan
 *                 color:
 *                   type: string
 *                   example: White
 *                 fuelType:
 *                   type: string
 *                   enum: [PETROL, DIESEL, ELECTRIC, HYBRID, GAS, OTHER]
 *                   example: PETROL
 *                 engineCapacity:
 *                   type: integer
 *                   example: 1800
 *                 odometerReading:
 *                   type: integer
 *                   example: 45000
 *                 seatingCapacity:
 *                   type: integer
 *                   example: 5
 *                 vehiclePurpose:
 *                   type: string
 *                   enum: [PERSONAL, COMMERCIAL, TAXI, GOVERNMENT]
 *                   example: PERSONAL
 *                 vehicleStatus:
 *                   type: string
 *                   enum: [NEW, USED, REBUILT]
 *                   example: USED
 *       404:
 *         description: Vehicle not found
 *       500:
 *         description: Internal server error
 */
router.get('/vehicle/:id/info', async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, manufacture: true, model: true, year: true,
        vehicleType: true, bodyType: true, color: true,
        fuelType: true, engineCapacity: true, odometerReading: true,
        seatingCapacity: true, vehiclePurpose: true, vehicleStatus: true,
      }
    });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(vehicle);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch vehicle info' });
  }
});



/**
 * @swagger
 * /api/vehicle-service/vehicle/{id}/owner:
 *   get:
 *     summary: Get vehicle owner details by ID
 *     tags: [Vehicle]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Owner details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   example: "64f1a2b3c4d5e6f7a8b9c0d1"
 *                 ownerName:
 *                   type: string
 *                   example: Jean Pierre Habimana
 *                 ownerType:
 *                   type: string
 *                   enum: [INDIVIDUAL, COMPANY, NGO, GOVERNMENT]
 *                   example: INDIVIDUAL
 *                 nationalId:
 *                   type: string
 *                   description: Exactly 16 digits
 *                   example: "1199880012345678"
 *                 passportNumber:
 *                   type: string
 *                   example: PC1234567
 *                 companyRegNumber:
 *                   type: string
 *                   example: RWA/2023/00123
 *                 address:
 *                   type: string
 *                   example: KG 123 St, Kigali
 *                 mobile:
 *                   type: string
 *                   description: Exactly 10 digits
 *                   example: "0788123456"
 *                 email:
 *                   type: string
 *                   format: email
 *                   example: jean.pierre@example.rw
 *       404:
 *         description: Vehicle not found
 *       500:
 *         description: Internal server error
 */
router.get('/vehicle/:id/owner', async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, ownerName: true, ownerType: true,
        nationalId: true, passportNumber: true,
        companyRegNumber: true, address: true,
        mobile: true, email: true,
      }
    });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(vehicle);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch owner details' });
  }
});



/**
 * @swagger
 * /api/vehicle-service/vehicle/{id}/registration:
 *   get:
 *     summary: Get vehicle registration details by ID
 *     tags: [Vehicle]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Registration details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   example: "64f1a2b3c4d5e6f7a8b9c0d1"
 *                 plateNumber:
 *                   type: string
 *                   example: RAA 123 B
 *                 registrationStatus:
 *                   type: string
 *                   enum: [ACTIVE, SUSPENDED, EXPIRED, PENDING]
 *                   example: ACTIVE
 *                 registrationDate:
 *                   type: string
 *                   format: date-time
 *                   example: "2023-01-15T00:00:00.000Z"
 *                 expiryDate:
 *                   type: string
 *                   format: date-time
 *                   example: "2026-01-15T00:00:00.000Z"
 *                 state:
 *                   type: string
 *                   example: Kigali
 *                 plateType:
 *                   type: string
 *                   enum: [PRIVATE, COMMERCIAL, GOVERNMENT, DIPLOMATIC, PERSONALIZED]
 *                   example: PRIVATE
 *       404:
 *         description: Vehicle not found
 *       500:
 *         description: Internal server error
 */
router.get('/vehicle/:id/registration', async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, plateNumber: true, registrationStatus: true,
        registrationDate: true, expiryDate: true,
        state: true, plateType: true,
      }
    });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(vehicle);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch registration details' });
  }
});



/**
 * @swagger
 * /api/vehicle-service/vehicle/{id}/insurance:
 *   get:
 *     summary: Get vehicle insurance details by ID
 *     tags: [Vehicle]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Insurance details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   example: "64f1a2b3c4d5e6f7a8b9c0d1"
 *                 policyNumber:
 *                   type: string
 *                   example: POL-2024-00456
 *                 companyName:
 *                   type: string
 *                   example: SANLAM Insurance Rwanda
 *                 insuranceExpiryDate:
 *                   type: string
 *                   format: date-time
 *                   example: "2026-06-30T00:00:00.000Z"
 *                 insuranceStatus:
 *                   type: string
 *                   enum: [ACTIVE, EXPIRED, CANCELLED]
 *                   example: ACTIVE
 *                 insuranceType:
 *                   type: string
 *                   example: Comprehensive
 *                 roadworthyCert:
 *                   type: string
 *                   example: RWC-2024-78901
 *                 customsRef:
 *                   type: string
 *                   example: CUS-RW-2023-11223
 *                 proofOfOwnership:
 *                   type: string
 *                   example: LOG-BOOK-2024-XYZ
 *       404:
 *         description: Vehicle not found
 *       500:
 *         description: Internal server error
 */
router.get('/vehicle/:id/insurance', async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, policyNumber: true, companyName: true,
        insuranceExpiryDate: true, insuranceStatus: true,
        insuranceType: true, roadworthyCert: true,
        customsRef: true, proofOfOwnership: true,
      }
    });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(vehicle);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch insurance details' });
  }
});



/**
 * @swagger
 * /api/vehicle-service/vehicle/{id}:
 *   put:
 *     summary: Update vehicle by ID
 *     tags: [Vehicle]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the vehicle
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VehicleInput'
 *     responses:
 *       200:
 *         description: Vehicle updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VehicleInput'
 *       422:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       500:
 *         description: Internal server error
 */
router.put('/vehicle/:id', validateVehicleUpdate, async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.update({
      where: { id: req.params.id },
      data: req.body
    });
    res.json(vehicle);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update vehicle' });
  }
});



/**
 * @swagger
 * /api/vehicle-service/vehicle/{id}:
 *   delete:
 *     summary: Delete vehicle by ID
 *     tags: [Vehicle]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the vehicle
 *     responses:
 *       200:
 *         description: Vehicle deleted successfully
 *         content:
 *           application/json:
 *             example:
 *               message: Vehicle deleted successfully
 *       404:
 *         description: Vehicle not found
 *       500:
 *         description: Internal server error
 */
router.delete('/vehicle/:id', async (req, res) => {
  try {
    await prisma.vehicle.delete({ where: { id: req.params.id } });
    res.json({ message: 'Vehicle deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete vehicle' });
  }
});


module.exports = router;