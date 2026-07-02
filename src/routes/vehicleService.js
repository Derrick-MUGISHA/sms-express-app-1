const express = require('express');
const { param } = require('express-validator');
const { validate } = require('../middleware/validate');
const prisma = require('../config/db');
const logger = require('../utils/logger');

const router = express.Router();

// ─── Enum constants ───────────────────────────────────────────────────────────

const VEHICLE_TYPES         = ['ELECTRIC', 'SUV', 'TRUCK', 'MOTORCYCLE', 'BUS', 'VAN', 'PICKUP', 'OTHER'];
const FUEL_TYPES            = ['PETROL', 'DIESEL', 'ELECTRIC', 'HYBRID', 'GAS', 'OTHER'];
const VEHICLE_PURPOSES      = ['PERSONAL', 'COMMERCIAL', 'TAXI', 'GOVERNMENT'];
const VEHICLE_STATUSES      = ['NEW', 'USED', 'REBUILT'];
const OWNER_TYPES           = ['INDIVIDUAL', 'COMPANY', 'NGO', 'GOVERNMENT'];
const PLATE_TYPES           = ['PRIVATE', 'COMMERCIAL', 'GOVERNMENT', 'DIPLOMATIC', 'PERSONALIZED'];
const REGISTRATION_STATUSES = ['ACTIVE', 'SUSPENDED', 'EXPIRED', 'PENDING'];
const INSURANCE_STATUSES    = ['ACTIVE', 'EXPIRED', 'CANCELLED'];

// Fields allowed when creating or updating a vehicle (prevents injecting id/timestamps)
const ALLOWED_VEHICLE_FIELDS = [
  'manufacture', 'model', 'year', 'vehicleType', 'bodyType', 'color',
  'fuelType', 'engineCapacity', 'odometerReading', 'seatingCapacity',
  'vehiclePurpose', 'vehicleStatus',
  'ownerName', 'ownerType', 'nationalId', 'passportNumber', 'companyRegNumber',
  'address', 'mobile', 'email',
  'plateNumber', 'registrationStatus', 'registrationDate', 'expiryDate',
  'state', 'plateType',
  'policyNumber', 'companyName', 'insuranceExpiryDate', 'insuranceStatus',
  'insuranceType', 'roadworthyCert', 'customsRef', 'proofOfOwnership',
];

const RW_PLATE_REGEX = /^(R[A-Z]{2}|GR|CD)\s?\d{3}\s?[A-Z]?$/i;
const EMAIL_REGEX    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isDateInPast(dateStr) {
  return new Date(dateStr) < new Date();
}

function pickAllowed(body) {
  return Object.fromEntries(
    Object.entries(body).filter(([k]) => ALLOWED_VEHICLE_FIELDS.includes(k))
  );
}

// ─── Validation middleware ────────────────────────────────────────────────────

function validateVehicle(req, res, next) {
  const errors = [];
  const d = req.body;

  if (!d.manufacture?.trim())  errors.push('manufacture is required.');
  if (!d.model?.trim())        errors.push('model is required.');

  if (!Number.isInteger(d.year) || d.year < 1886 || d.year > new Date().getFullYear() + 1)
    errors.push(`year must be an integer between 1886 and ${new Date().getFullYear() + 1}.`);
  if (!d.vehicleType || !VEHICLE_TYPES.includes(d.vehicleType))
    errors.push(`vehicleType must be one of: ${VEHICLE_TYPES.join(', ')}.`);
  if (!d.bodyType?.trim())     errors.push('bodyType is required.');
  if (!d.color?.trim())        errors.push('color is required.');
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

  if (!d.ownerName?.trim())    errors.push('ownerName is required.');
  if (!d.ownerType || !OWNER_TYPES.includes(d.ownerType))
    errors.push(`ownerType must be one of: ${OWNER_TYPES.join(', ')}.`);
  if (!d.nationalId || !/^\d{16}$/.test(d.nationalId))
    errors.push('nationalId must be exactly 16 digits.');
  if (d.passportNumber !== undefined && d.passportNumber !== null && typeof d.passportNumber === 'string' && !d.passportNumber.trim())
    errors.push('passportNumber, if provided, must be a non-empty string.');
  if (d.ownerType === 'COMPANY' && !d.companyRegNumber?.trim())
    errors.push('companyRegNumber is required for COMPANY ownerType.');
  if (!d.address?.trim())      errors.push('address is required.');
  if (!d.mobile || !/^\d{10}$/.test(d.mobile))
    errors.push('mobile must be exactly 10 digits.');
  if (!d.email || !EMAIL_REGEX.test(d.email))
    errors.push('email must be a valid email address.');

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
  if (!d.state?.trim())        errors.push('state is required.');
  if (!d.plateType || !PLATE_TYPES.includes(d.plateType))
    errors.push(`plateType must be one of: ${PLATE_TYPES.join(', ')}.`);

  if (!d.policyNumber?.trim()) errors.push('policyNumber is required.');
  if (!d.companyName?.trim())  errors.push('companyName (insurer) is required.');
  if (!d.insuranceExpiryDate || isNaN(new Date(d.insuranceExpiryDate).getTime()))
    errors.push('insuranceExpiryDate must be a valid date-time string.');
  else if (isDateInPast(d.insuranceExpiryDate))
    errors.push('insuranceExpiryDate must not be in the past.');
  if (d.insuranceStatus && !INSURANCE_STATUSES.includes(d.insuranceStatus))
    errors.push(`insuranceStatus must be one of: ${INSURANCE_STATUSES.join(', ')}.`);
  if (!d.insuranceType?.trim())  errors.push('insuranceType is required.');
  if (!d.roadworthyCert?.trim()) errors.push('roadworthyCert is required.');
  if (!d.customsRef?.trim())     errors.push('customsRef is required.');
  if (!d.proofOfOwnership?.trim()) errors.push('proofOfOwnership is required.');

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
    else if (isDateInPast(d.insuranceExpiryDate))         errors.push('insuranceExpiryDate must not be in the past.');
  }

  if (errors.length > 0) return res.status(422).json({ errors });
  next();
}

// Shared MongoDB ObjectId path param validator
const vehicleIdParam = [
  param('id').isMongoId().withMessage('Invalid vehicle ID — must be a 24-character hex MongoDB ObjectId'),
  validate,
];

// ─── Swagger schemas ──────────────────────────────────────────────────────────

/**
 * @swagger
 * components:
 *   schemas:
 *     VehicleValidationError:
 *       type: object
 *       properties:
 *         errors:
 *           type: array
 *           items:
 *             type: string
 *           example:
 *             - "nationalId must be exactly 16 digits."
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
 *           description: Exactly 16 digits
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
 *           description: Exactly 10 digits
 *           example: "0788123456"
 *         email:
 *           type: string
 *           format: email
 *           example: owner@example.rw
 *         plateNumber:
 *           type: string
 *           description: "Valid Rwandan plate: RAA 123 B, GR 456, CD 789 A"
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
 *           example: "2027-01-15T00:00:00.000Z"
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
 *           example: "2027-06-30T00:00:00.000Z"
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
 *   description: Vehicle registration and management (public — no authentication required)
 */

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/vehicle-service/vehicle:
 *   post:
 *     summary: Register a new vehicle
 *     tags: [Vehicle]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VehicleInput'
 *     responses:
 *       201:
 *         description: Vehicle registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VehicleInput'
 *       422:
 *         description: Validation errors — all failed rules are listed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VehicleValidationError'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/vehicle', validateVehicle, async (req, res) => {
  try {
    const data = pickAllowed(req.body);
    const vehicle = await prisma.vehicle.create({ data });
    res.status(201).json(vehicle);
  } catch (err) {
    logger.error('Create vehicle error:', err);
    res.status(500).json({ error: 'Failed to create vehicle' });
  }
});

// ─── List ─────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/vehicle-service/vehicle:
 *   get:
 *     summary: List all vehicles
 *     tags: [Vehicle]
 *     security: []
 *     responses:
 *       200:
 *         description: Array of all vehicle records
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/VehicleInput'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/vehicle', async (req, res) => {
  try {
    const vehicles = await prisma.vehicle.findMany();
    res.json(vehicles);
  } catch (err) {
    logger.error('Get vehicles error:', err);
    res.status(500).json({ error: 'Failed to fetch vehicles' });
  }
});

// ─── Get full record ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/vehicle-service/vehicle/{id}:
 *   get:
 *     summary: Get the full vehicle record by ID
 *     tags: [Vehicle]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the vehicle
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: Full vehicle record
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VehicleInput'
 *       400:
 *         description: Invalid ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       404:
 *         description: Vehicle not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Vehicle not found
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/vehicle/:id', vehicleIdParam, async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: req.params.id } });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(vehicle);
  } catch (err) {
    logger.error('Get vehicle error:', err);
    res.status(500).json({ error: 'Failed to fetch vehicle' });
  }
});

// ─── Technical info ───────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/vehicle-service/vehicle/{id}/info:
 *   get:
 *     summary: Get vehicle technical information (make, model, engine, etc.)
 *     tags: [Vehicle]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: Vehicle technical info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *                 manufacture: { type: string, example: Toyota }
 *                 model: { type: string, example: Corolla }
 *                 year: { type: integer, example: 2020 }
 *                 vehicleType: { type: string, enum: [ELECTRIC, SUV, TRUCK, MOTORCYCLE, BUS, VAN, PICKUP, OTHER] }
 *                 bodyType: { type: string, example: Sedan }
 *                 color: { type: string, example: White }
 *                 fuelType: { type: string, enum: [PETROL, DIESEL, ELECTRIC, HYBRID, GAS, OTHER] }
 *                 engineCapacity: { type: integer, example: 1800 }
 *                 odometerReading: { type: integer, example: 45000 }
 *                 seatingCapacity: { type: integer, example: 5 }
 *                 vehiclePurpose: { type: string, enum: [PERSONAL, COMMERCIAL, TAXI, GOVERNMENT] }
 *                 vehicleStatus: { type: string, enum: [NEW, USED, REBUILT] }
 *       400:
 *         description: Invalid ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       404:
 *         description: Vehicle not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/vehicle/:id/info', vehicleIdParam, async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, manufacture: true, model: true, year: true,
        vehicleType: true, bodyType: true, color: true,
        fuelType: true, engineCapacity: true, odometerReading: true,
        seatingCapacity: true, vehiclePurpose: true, vehicleStatus: true,
      },
    });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(vehicle);
  } catch (err) {
    logger.error('Get vehicle info error:', err);
    res.status(500).json({ error: 'Failed to fetch vehicle info' });
  }
});

// ─── Owner info ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/vehicle-service/vehicle/{id}/owner:
 *   get:
 *     summary: Get vehicle owner details
 *     tags: [Vehicle]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: Owner details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *                 ownerName: { type: string, example: Jean Pierre Habimana }
 *                 ownerType: { type: string, enum: [INDIVIDUAL, COMPANY, NGO, GOVERNMENT] }
 *                 nationalId: { type: string, description: Exactly 16 digits }
 *                 passportNumber: { type: string }
 *                 companyRegNumber: { type: string }
 *                 address: { type: string }
 *                 mobile: { type: string, description: Exactly 10 digits }
 *                 email: { type: string, format: email }
 *       400:
 *         description: Invalid ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       404:
 *         description: Vehicle not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/vehicle/:id/owner', vehicleIdParam, async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, ownerName: true, ownerType: true,
        nationalId: true, passportNumber: true,
        companyRegNumber: true, address: true,
        mobile: true, email: true,
      },
    });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(vehicle);
  } catch (err) {
    logger.error('Get vehicle owner error:', err);
    res.status(500).json({ error: 'Failed to fetch owner details' });
  }
});

// ─── Registration info ────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/vehicle-service/vehicle/{id}/registration:
 *   get:
 *     summary: Get vehicle registration details
 *     tags: [Vehicle]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: Registration details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *                 plateNumber: { type: string, example: RAA 123 B }
 *                 registrationStatus: { type: string, enum: [ACTIVE, SUSPENDED, EXPIRED, PENDING] }
 *                 registrationDate: { type: string, format: date-time }
 *                 expiryDate: { type: string, format: date-time }
 *                 state: { type: string, example: Kigali }
 *                 plateType: { type: string, enum: [PRIVATE, COMMERCIAL, GOVERNMENT, DIPLOMATIC, PERSONALIZED] }
 *       400:
 *         description: Invalid ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       404:
 *         description: Vehicle not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/vehicle/:id/registration', vehicleIdParam, async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, plateNumber: true, registrationStatus: true,
        registrationDate: true, expiryDate: true,
        state: true, plateType: true,
      },
    });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(vehicle);
  } catch (err) {
    logger.error('Get vehicle registration error:', err);
    res.status(500).json({ error: 'Failed to fetch registration details' });
  }
});

// ─── Insurance info ───────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/vehicle-service/vehicle/{id}/insurance:
 *   get:
 *     summary: Get vehicle insurance details
 *     tags: [Vehicle]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: Insurance details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *                 policyNumber: { type: string, example: POL-2024-00456 }
 *                 companyName: { type: string, example: SANLAM Insurance Rwanda }
 *                 insuranceExpiryDate: { type: string, format: date-time }
 *                 insuranceStatus: { type: string, enum: [ACTIVE, EXPIRED, CANCELLED] }
 *                 insuranceType: { type: string, example: Comprehensive }
 *                 roadworthyCert: { type: string, example: RWC-2024-78901 }
 *                 customsRef: { type: string, example: CUS-RW-2023-11223 }
 *                 proofOfOwnership: { type: string, example: LOG-BOOK-2024-XYZ }
 *       400:
 *         description: Invalid ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       404:
 *         description: Vehicle not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/vehicle/:id/insurance', vehicleIdParam, async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, policyNumber: true, companyName: true,
        insuranceExpiryDate: true, insuranceStatus: true,
        insuranceType: true, roadworthyCert: true,
        customsRef: true, proofOfOwnership: true,
      },
    });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(vehicle);
  } catch (err) {
    logger.error('Get vehicle insurance error:', err);
    res.status(500).json({ error: 'Failed to fetch insurance details' });
  }
});

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/vehicle-service/vehicle/{id}:
 *   put:
 *     summary: Update a vehicle record (partial update — only send changed fields)
 *     tags: [Vehicle]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VehicleInput'
 *     responses:
 *       200:
 *         description: Updated vehicle record
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VehicleInput'
 *       400:
 *         description: Invalid ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       404:
 *         description: Vehicle not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Vehicle not found
 *       422:
 *         description: Validation errors in the updated fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VehicleValidationError'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put('/vehicle/:id', vehicleIdParam, validateVehicleUpdate, async (req, res) => {
  try {
    const data = pickAllowed(req.body);
    const vehicle = await prisma.vehicle.update({
      where: { id: req.params.id },
      data,
    });
    res.json(vehicle);
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Vehicle not found' });
    }
    logger.error('Update vehicle error:', err);
    res.status(500).json({ error: 'Failed to update vehicle' });
  }
});

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/vehicle-service/vehicle/{id}:
 *   delete:
 *     summary: Delete a vehicle record
 *     tags: [Vehicle]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: Vehicle deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Vehicle deleted successfully
 *       400:
 *         description: Invalid ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       404:
 *         description: Vehicle not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Vehicle not found
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete('/vehicle/:id', vehicleIdParam, async (req, res) => {
  try {
    await prisma.vehicle.delete({ where: { id: req.params.id } });
    res.json({ message: 'Vehicle deleted successfully' });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Vehicle not found' });
    }
    logger.error('Delete vehicle error:', err);
    res.status(500).json({ error: 'Failed to delete vehicle' });
  }
});

module.exports = router;
