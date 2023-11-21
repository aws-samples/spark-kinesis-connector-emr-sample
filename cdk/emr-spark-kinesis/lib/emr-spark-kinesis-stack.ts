import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as emr from 'aws-cdk-lib/aws-emr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from "path";
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as cfninc from 'aws-cdk-lib/cloudformation-include';

export class EmrSparkKinesisStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, 'VPC', {
      enableDnsHostnames: true,
      enableDnsSupport: true,
      maxAzs: 3,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public-subnet-1',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'private-subnet',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        }
      ],
    });

    const include = new cfninc.CfnInclude(this, 'ExistingInfrastructure', {
      templateFile: path.join(__dirname,'../scripts/kinesisDataGenerator.yaml'),
    });


    const emrServiceRole = new iam.Role(this, 'EMR Service Role', {
      assumedBy: new iam.ServicePrincipal("elasticmapreduce.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonElasticMapReduceRole')],
    });

    const emrJobFlowRole = new iam.Role(this, 'EMR Job Flow Role', {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonElasticMapReduceforEC2Role'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonKinesisFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedEC2InstanceDefaultPolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchFullAccess'),
      ],
    });

    const emrInstanceProfile = new iam.CfnInstanceProfile(this, 'EMR InstanceProfile', {
      instanceProfileName: 'emr-instance-profile-spark-kinesis',
      roles: [emrJobFlowRole.roleName]
    });

    const cfnCluster = new emr.CfnCluster(this, 'EMR Spark Cluster', {
      jobFlowRole: emrInstanceProfile.instanceProfileName!,
      name: "emr-spark-kinesis",
      serviceRole: emrServiceRole.roleName,
      releaseLabel: 'emr-6.14.0',
      instances: {
        coreInstanceGroup: {
          instanceType: "m5.xlarge",
          instanceCount: 1,
        },
        masterInstanceGroup: {
          instanceType: "m5.xlarge",
          instanceCount: 1
        },
        ec2SubnetId: vpc.publicSubnets[0].subnetId,
      },
      applications: [{
        name: 'Spark'
      },
        {
          name: 'Hive'
        },
        {
          name: 'Hadoop'
        }],
      steps: [{
        actionOnFailure: "CONTINUE",
        hadoopJarStep: {
          jar: "command-runner.jar",
          args: ['bash', '-c',"wget https://data-streaming-labs.s3.amazonaws.com/emr-spark-kinesis-sample/spark-kinesis.sh; sh spark-kinesis.sh"]
        },
        name: 'kinesis-connector-setup'
        }
      ]
    })

    cfnCluster.node.addDependency(emrInstanceProfile)
    cfnCluster.node.addDependency(emrServiceRole)
    cfnCluster.node.addDependency(emrJobFlowRole)

    const kinesisSourceStream = new kinesis.Stream(this, 'Kinesis Spark Source Stream', {
      streamName: 'kinesis-source',
      streamMode: kinesis.StreamMode.ON_DEMAND
    })

    const kinesisSinkStream = new kinesis.Stream(this, 'Kinesis Spark Sink Stream', {
      streamName: 'kinesis-sink',
      streamMode: kinesis.StreamMode.ON_DEMAND
    })

    const cfnStreamConsumer = new kinesis.CfnStreamConsumer(this, 'MyCfnStreamConsumer', {
      consumerName: 'efo-consumer',
      streamArn: kinesisSourceStream.streamArn,
    });

  }
}

