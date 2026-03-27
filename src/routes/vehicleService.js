const express = require('express');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();
const prisma = new PrismaClient();

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
 *             type: object
 *             properties:
 *               vin:
 *                 type: string
 *               engineNumber:
 *                 type: string
 *               make:
 *                 type: string
 *               model:
 *                 type: string
 *               year:
 *                 type: integer
 *               vehicleType:
 *                 type: string
 *               bodyType:
 *                 type: string
 *               color:
 *                 type: string
 *               fuelType:
 *                 type: string
 *               engineCapacity:
 *                 type: integer
 *               odometerReading:
 *                 type: integer
 *               seatingCapacity:
 *                 type: integer
 *               vehiclePurpose:
 *                 type: string
 *               vehicleStatus:
 *                 type: string
 *               ownerId:
 *                 type: string
 *               ownerName:
 *                 type: string
 *               ownerType:
 *                 type: string
 *               tin:
 *                 type: string
 *               nationalId:
 *                 type: string
 *               passportNumber:
 *                 type: string
 *               companyRegNumber:
 *                 type: string
 *               address:
 *                 type: string
 *               mobile:
 *                 type: string
 *               email:
 *                 type: string
 *               registrationId:
 *                 type: string
 *               plateNumber:
 *                 type: string
 *               registrationStatus:
 *                 type: string
 *               registrationDate:
 *                 type: string
 *                 format: date-time
 *               expiryDate:
 *                 type: string
 *                 format: date-time
 *               state:
 *                 type: string
 *               plateType:
 *                 type: string
 *               insuranceId:
 *                 type: string
 *               policyNumber:
 *                 type: string
 *               companyName:
 *                 type: string
 *               insuranceExpiryDate:
 *                 type: string
 *                 format: date-time
 *               insuranceStatus:
 *                 type: string
 *               insuranceType:
 *                 type: string
 *               roadworthyCert:
 *                 type: string
 *               customsRef:
 *                 type: string
 *               proofOfOwnership:
 *                 type: string
 *     responses:
 *       201:
 *         description: Vehicle created successfully
 *       500:
 *         description: Internal server error
 */
router.post('/vehicle', async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.create({
      data: req.body
    });
    res.status(201).json(vehicle);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create vehicle' });
  }
});

/**
 * @swagger
 * /api/vehicle-service/vehicle/{vin}:
 *   get:
 *     summary: Get vehicle by VIN
 *     tags: [Vehicle]
 *     parameters:
 *       - in: path
 *         name: vin
 *         required: true
 *         schema:
 *           type: string
 *         description: VIN of the vehicle
 *     responses:
 *       200:
 *         description: Vehicle retrieved successfully
 *       404:
 *         description: Vehicle not found
 *       500:
 *         description: Internal server error
 */
router.get('/vehicle/:vin', async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { vin: req.params.vin },
      include: { owner: true, registration: true, insurance: true }
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
 * /api/vehicle-service/vehicle/{vin}:
 *   put:
 *     summary: Update vehicle by VIN
 *     tags: [Vehicle]
 *     parameters:
 *       - in: path
 *         name: vin
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Vehicle updated successfully
 *       500:
 *         description: Internal server error
 */
router.put('/vehicle/:vin', async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.update({
      where: { vin: req.params.vin },
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
 * /api/vehicle-service/vehicle/{vin}:
 *   delete:
 *     summary: Delete vehicle by VIN
 *     tags: [Vehicle]
 *     parameters:
 *       - in: path
 *         name: vin
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Vehicle deleted successfully
 *       500:
 *         description: Internal server error
 */
router.delete('/vehicle/:vin', async (req, res) => {
  try {
    await prisma.vehicle.delete({
      where: { vin: req.params.vin }
    });
    res.json({ message: 'Vehicle deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete vehicle' });
  }
});

module.exports = router;