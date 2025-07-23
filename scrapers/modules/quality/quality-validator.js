/**
 * Quality Validator Module
 * Implements IQualityValidator interface for outlier detection and data quality validation
 */

const { IQualityValidator } = require('../interfaces');

class QualityValidator extends IQualityValidator {
    constructor(config) {
        super(config);
        this.outlierThresholds = config.getOutlierThresholds();
        this.priceValidation = config.getPriceValidation();
        this.qualityConfig = config.getQualityConfig();
    }

    /**
     * Detect if prices are outliers
     */
    detectOutliers(lokalerPrice, oekostromPrice) {
        const result = {
            hasOutliers: false,
            lokalerOutlier: false,
            oekostromOutlier: false,
            severity: 'normal',
            warnings: [],
            outlierTypes: []
        };

        // Check lokaler versorger price
        if (lokalerPrice) {
            const lokalerAnalysis = this.analyzePriceOutlier(lokalerPrice, 'Lokaler Versorger');
            if (lokalerAnalysis.isOutlier) {
                result.lokalerOutlier = true;
                result.hasOutliers = true;
                result.warnings.push(lokalerAnalysis.warning);
                result.outlierTypes.push('lokaler_versorger');
                
                // Update severity (take highest)
                if (this.getSeverityLevel(lokalerAnalysis.severity) > this.getSeverityLevel(result.severity)) {
                    result.severity = lokalerAnalysis.severity;
                }
            }
        }

        // Check oekostrom price
        if (oekostromPrice) {
            const oekoAnalysis = this.analyzePriceOutlier(oekostromPrice, 'Ökostrom');
            if (oekoAnalysis.isOutlier) {
                result.oekostromOutlier = true;
                result.hasOutliers = true;
                result.warnings.push(oekoAnalysis.warning);
                result.outlierTypes.push('oekostrom');
                
                // Update severity (take highest)
                if (this.getSeverityLevel(oekoAnalysis.severity) > this.getSeverityLevel(result.severity)) {
                    result.severity = oekoAnalysis.severity;
                }
            }
        }

        // Additional outlier checks
        const additionalChecks = this.performAdditionalOutlierChecks(lokalerPrice, oekostromPrice);
        if (additionalChecks.hasIssues) {
            result.warnings.push(...additionalChecks.warnings);
            if (additionalChecks.isOutlier) {
                result.hasOutliers = true;
                result.outlierTypes.push(...additionalChecks.types);
            }
        }

        // Log outlier detection if enabled
        if (result.hasOutliers && this.config.getLoggingConfig().enableOutlierLogging) {
            this.logOutlierDetection(result, lokalerPrice, oekostromPrice);
        }

        return result;
    }

    /**
     * Analyze individual price for outlier characteristics
     */
    analyzePriceOutlier(price, priceType) {
        const thresholds = this.outlierThresholds;
        
        if (price >= thresholds.extreme) {
            return {
                isOutlier: true,
                severity: 'extreme',
                warning: `${priceType} price €${price.toFixed(4)} is extreme (≥€${thresholds.extreme}) - likely invalid`
            };
        } else if (price >= thresholds.veryHigh) {
            return {
                isOutlier: true,
                severity: 'very_high',
                warning: `${priceType} price €${price.toFixed(4)} is very high (≥€${thresholds.veryHigh})`
            };
        } else if (price >= thresholds.high) {
            return {
                isOutlier: true,
                severity: 'high',
                warning: `${priceType} price €${price.toFixed(4)} is high (≥€${thresholds.high})`
            };
        }

        return {
            isOutlier: false,
            severity: 'normal',
            warning: null
        };
    }

    /**
     * Perform additional outlier checks (price relationships, etc.)
     */
    performAdditionalOutlierChecks(lokalerPrice, oekostromPrice) {
        const result = {
            hasIssues: false,
            isOutlier: false,
            warnings: [],
            types: []
        };

        // Check if both prices exist
        if (lokalerPrice && oekostromPrice) {
            // Check for unrealistic price differences
            const priceDifference = Math.abs(lokalerPrice - oekostromPrice);
            const averagePrice = (lokalerPrice + oekostromPrice) / 2;
            const differencePercentage = (priceDifference / averagePrice) * 100;

            if (differencePercentage > 200) { // More than 200% difference
                result.hasIssues = true;
                result.isOutlier = true;
                result.warnings.push(`Extreme price difference: ${differencePercentage.toFixed(1)}% (€${priceDifference.toFixed(4)})`);
                result.types.push('extreme_difference');
            } else if (differencePercentage > 100) { // More than 100% difference
                result.hasIssues = true;
                result.warnings.push(`Large price difference: ${differencePercentage.toFixed(1)}% (€${priceDifference.toFixed(4)})`);
            }

            // Check for inverted pricing (green energy significantly more expensive)
            if (oekostromPrice > lokalerPrice * 1.5) {
                result.hasIssues = true;
                result.warnings.push(`Ökostrom price significantly higher than local provider (${((oekostromPrice/lokalerPrice - 1) * 100).toFixed(1)}% more)`);
            }
        }

        // Check for single price scenarios
        if (!lokalerPrice && oekostromPrice) {
            result.hasIssues = true;
            result.warnings.push('Only Ökostrom price found - missing local provider price');
        } else if (lokalerPrice && !oekostromPrice) {
            result.hasIssues = true;
            result.warnings.push('Only local provider price found - missing Ökostrom price');
        }

        return result;
    }

    /**
     * Validate extracted price data
     */
    validatePriceData(priceData) {
        const validation = {
            valid: true,
            quality_score: 1.0,
            issues: [],
            warnings: []
        };

        // Check required fields
        if (!priceData) {
            validation.valid = false;
            validation.quality_score = 0;
            validation.issues.push('No price data provided');
            return validation;
        }

        // Validate individual prices
        if (priceData.lokaler_versorger_price) {
            if (!this.config.isValidPrice(priceData.lokaler_versorger_price)) {
                validation.valid = false;
                validation.issues.push('Invalid lokaler versorger price range');
                validation.quality_score -= 0.5;
            }
        }

        if (priceData.oekostrom_price) {
            if (!this.config.isValidPrice(priceData.oekostrom_price)) {
                validation.valid = false;
                validation.issues.push('Invalid ökostrom price range');
                validation.quality_score -= 0.5;
            }
        }

        // Check if we have at least one price
        if (!priceData.lokaler_versorger_price && !priceData.oekostrom_price) {
            validation.valid = false;
            validation.quality_score = 0;
            validation.issues.push('No valid prices found');
            return validation;
        }

        // Quality scoring based on completeness
        if (priceData.lokaler_versorger_price && priceData.oekostrom_price) {
            // Both prices found - full score
            validation.quality_score = 1.0;
        } else {
            // Only one price found - reduced score
            validation.quality_score = 0.7;
            validation.warnings.push('Only one price type found');
        }

        // Check extraction method quality
        if (priceData.extraction_method) {
            switch (priceData.extraction_method) {
                case 'tableFirst':
                    // No penalty - preferred method
                    break;
                case 'regexFallback':
                    validation.quality_score -= 0.1;
                    validation.warnings.push('Used fallback extraction method');
                    break;
                case 'failed':
                    validation.valid = false;
                    validation.quality_score = 0;
                    validation.issues.push('Extraction failed');
                    break;
            }
        }

        // Ensure quality score doesn't go below 0
        validation.quality_score = Math.max(0, validation.quality_score);

        return validation;
    }

    /**
     * Attempt to validate/correct outlier prices
     */
    async validateOutliers(outlierData, html) {
        const validation = {
            validation_attempted: true,
            validation_successful: false,
            original_prices: {
                lokaler_versorger_price: outlierData.lokaler_versorger_price,
                oekostrom_price: outlierData.oekostrom_price
            },
            validated_prices: {
                lokaler_versorger_price: outlierData.lokaler_versorger_price,
                oekostrom_price: outlierData.oekostrom_price
            },
            validation_notes: [],
            confidence_score: 0
        };

        try {
            // For now, we'll implement basic outlier validation
            // In a full implementation, this could re-parse the HTML with stricter criteria
            
            validation.validation_notes.push('Outlier validation attempted');
            
            // Simple validation: if prices are extreme (>€2), mark as failed
            if (outlierData.lokaler_versorger_price > this.outlierThresholds.extreme ||
                outlierData.oekostrom_price > this.outlierThresholds.extreme) {
                validation.validation_notes.push('Prices exceed extreme threshold - validation failed');
                validation.confidence_score = 0;
            } else {
                // For high outliers, we could attempt re-extraction with stricter patterns
                validation.validation_notes.push('Prices within acceptable outlier range');
                validation.validation_successful = true;
                validation.confidence_score = 0.6;
            }

        } catch (error) {
            validation.validation_notes.push(`Validation error: ${error.message}`);
            validation.confidence_score = 0;
        }

        return validation;
    }

    /**
     * Get quality metrics for a set of results
     */
    getQualityMetrics(results) {
        if (!results || results.length === 0) {
            return {
                total_results: 0,
                quality_summary: 'No results to analyze'
            };
        }

        const metrics = {
            total_results: results.length,
            complete_data: 0,        // Both prices found
            partial_data: 0,         // Only one price found
            outliers_detected: 0,
            high_outliers: 0,
            very_high_outliers: 0,
            extreme_outliers: 0,
            average_quality_score: 0,
            data_completeness: 0,
            extraction_methods: {},
            price_statistics: {
                lokaler_versorger: { count: 0, average: 0, min: Infinity, max: 0 },
                oekostrom: { count: 0, average: 0, min: Infinity, max: 0 }
            }
        };

        let totalQualityScore = 0;
        let lokalerPrices = [];
        let oekoPrices = [];

        for (const result of results) {
            // Count complete vs partial data
            if (result.lokaler_versorger_price && result.oekostrom_price) {
                metrics.complete_data++;
            } else if (result.lokaler_versorger_price || result.oekostrom_price) {
                metrics.partial_data++;
            }

            // Count outliers by severity
            if (result.is_outlier) {
                metrics.outliers_detected++;
                switch (result.outlier_severity) {
                    case 'high':
                        metrics.high_outliers++;
                        break;
                    case 'very_high':
                        metrics.very_high_outliers++;
                        break;
                    case 'extreme':
                        metrics.extreme_outliers++;
                        break;
                }
            }

            // Accumulate quality scores
            totalQualityScore += result.quality_score || 1.0;

            // Track extraction methods
            if (result.extraction_method) {
                metrics.extraction_methods[result.extraction_method] = 
                    (metrics.extraction_methods[result.extraction_method] || 0) + 1;
            }

            // Collect price statistics
            if (result.lokaler_versorger_price) {
                lokalerPrices.push(result.lokaler_versorger_price);
            }
            if (result.oekostrom_price) {
                oekoPrices.push(result.oekostrom_price);
            }
        }

        // Calculate derived metrics
        metrics.average_quality_score = totalQualityScore / results.length;
        metrics.data_completeness = (metrics.complete_data / results.length) * 100;

        // Calculate price statistics
        if (lokalerPrices.length > 0) {
            metrics.price_statistics.lokaler_versorger = {
                count: lokalerPrices.length,
                average: lokalerPrices.reduce((a, b) => a + b, 0) / lokalerPrices.length,
                min: Math.min(...lokalerPrices),
                max: Math.max(...lokalerPrices)
            };
        }

        if (oekoPrices.length > 0) {
            metrics.price_statistics.oekostrom = {
                count: oekoPrices.length,
                average: oekoPrices.reduce((a, b) => a + b, 0) / oekoPrices.length,
                min: Math.min(...oekoPrices),
                max: Math.max(...oekoPrices)
            };
        }

        return metrics;
    }

    /**
     * Get severity level as number for comparison
     */
    getSeverityLevel(severity) {
        switch (severity) {
            case 'normal': return 0;
            case 'high': return 1;
            case 'very_high': return 2;
            case 'extreme': return 3;
            default: return 0;
        }
    }

    /**
     * Log outlier detection result
     */
    logOutlierDetection(result, lokalerPrice, oekostromPrice) {
        console.log(`    🚨 OUTLIER DETECTED - Severity: ${result.severity.toUpperCase()}`);
        if (lokalerPrice) console.log(`       Lokaler Versorger: €${lokalerPrice.toFixed(4)}`);
        if (oekostromPrice) console.log(`       Ökostrom: €${oekostromPrice.toFixed(4)}`);
        
        result.warnings.forEach(warning => {
            console.log(`       • ${warning}`);
        });
    }

    /**
     * Check if quality validation is enabled
     */
    isQualityValidationEnabled() {
        return this.qualityConfig.enablePriceValidation;
    }

    /**
     * Check if outlier detection is enabled
     */
    isOutlierDetectionEnabled() {
        return this.qualityConfig.enableOutlierDetection;
    }

    /**
     * Get quality thresholds
     */
    getQualityThresholds() {
        return {
            outlierThresholds: this.outlierThresholds,
            priceValidation: this.priceValidation,
            qualityConfig: this.qualityConfig
        };
    }

    /**
     * Generate quality report for a set of results
     */
    generateQualityReport(results) {
        const metrics = this.getQualityMetrics(results);
        
        const report = {
            generated_at: new Date().toISOString(),
            summary: {
                total_results: metrics.total_results,
                data_completeness: `${metrics.data_completeness.toFixed(1)}%`,
                average_quality_score: metrics.average_quality_score.toFixed(2),
                outlier_rate: `${((metrics.outliers_detected / metrics.total_results) * 100).toFixed(1)}%`
            },
            details: metrics,
            recommendations: this.generateQualityRecommendations(metrics)
        };

        return report;
    }

    /**
     * Generate quality improvement recommendations
     */
    generateQualityRecommendations(metrics) {
        const recommendations = [];

        if (metrics.data_completeness < 80) {
            recommendations.push('Data completeness is below 80% - consider improving extraction strategies');
        }

        if (metrics.average_quality_score < 0.8) {
            recommendations.push('Average quality score is low - review extraction methods and validation rules');
        }

        if (metrics.outliers_detected > metrics.total_results * 0.1) {
            recommendations.push('High outlier rate detected - review price validation thresholds');
        }

        if (metrics.extreme_outliers > 0) {
            recommendations.push('Extreme outliers found - these likely indicate extraction errors');
        }

        if (recommendations.length === 0) {
            recommendations.push('Data quality looks good - no immediate improvements needed');
        }

        return recommendations;
    }
}

module.exports = QualityValidator; 